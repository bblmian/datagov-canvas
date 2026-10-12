// Graphical editing: every operation is turned into a precise change of the DBML text, using the
// source ranges from EditInfo. Only the parts being edited are rewritten, so the rest of the
// document (comments, formatting, settings this editor doesn't know about) is left alone.
import { bodyStatements, findTop, parseField, skip, splitTop, str, type FieldParts } from './text';
import { isMany, type BlockInfo, type DDep, type DDepEnd, type DEndpoint, type DField, type DIndex, type DiagramModel, type DRef, type DTable, type DView, type EditInfo, type Loc, type ViewSelection } from './types';

export interface EditCtx {
  source: string;
  model: DiagramModel;
  info: EditInfo;
}

export interface EditResult {
  source: string;
  /** ids changed by a rename (old → new), so saved positions can follow */
  renamed?: Record<string, string>;
  /** ids of tables/notes that no longer exist */
  removed?: string[];
  /** id of the element the edit created */
  created?: string;
}

/** `>` many-to-one, `<` one-to-many, `-` one-to-one, `<>` many-to-many (read from the first endpoint) */
export type RefOp = '>' | '<' | '-' | '<>';
export const REF_ACTIONS = ['cascade', 'restrict', 'set null', 'set default', 'no action'] as const;
export const INDEX_TYPES = ['btree', 'hash'] as const;

export interface FieldPatch {
  name?: string;
  type?: string;
  pk?: boolean;
  notNull?: boolean;
  unique?: boolean;
  increment?: boolean;
  /** empty string removes the default */
  defaultValue?: string;
  /** empty string removes the note */
  note?: string;
  /** all check constraint expressions (without backticks), in order; [] removes them */
  checks?: string[];
  /** how `defaultValue` is written: a string (quoted), number, boolean, null or `expression` */
  defaultKind?: 'string' | 'number' | 'boolean' | 'null' | 'expression';
  /** custom `key: value` settings on the column (replaces all of them) */
  custom?: Record<string, string>;
  /** the column's inline ref (`[ref: > table.column]`); null removes it */
  ref?: { op: RefOp; target: string } | null;
}

/** A refusal the UI can explain; `code` is an i18n key suffix (`edit.error.<code>`). */
export class EditError extends Error {
  constructor(public code: 'lastColumn' | 'duplicate' | 'emptyEnum' | 'columnCount' | 'depEdges' | 'partialRef' | 'oneRecords', public detail = '') {
    super(`${code}${detail ? `: ${detail}` : ''}`);
  }
}

// ---- text helpers -------------------------------------------------------------------------

type Change = Loc & { text: string };

function apply(source: string, changes: Change[]): string {
  const sorted = [...changes].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = source;
  let limit = Infinity;
  for (const c of sorted) {
    if (c.end > limit) throw new Error('overlapping edits');
    out = out.slice(0, c.start) + c.text + out.slice(c.end);
    limit = c.start;
  }
  return out;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const ident = (name: string) => (IDENT.test(name) ? name : `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);

export { str };

const expr = (e: string) => `\`${e.trim().replace(/^`|`$/g, '')}\``;

/** Column types: plain ones (`varchar(255)`, `decimal(10,2)`, `int[]`, `s.my_enum`) as is, others quoted. */
function typeText(t: string): string {
  const v = t.trim();
  if (!v) return 'varchar';
  if (v.startsWith('"') || /^[A-Za-z_][\w.]*(\s*\([^()]*\))?(\[\])?$/.test(v)) return v;
  return `"${v.replace(/"/g, '\\"')}"`;
}

/** Values as typed by the user: numbers, booleans, null, quoted strings and `expressions` stay as is. */
function literal(v: string): string {
  const s = v.trim();
  if (/^-?\d+(\.\d+)?$/.test(s) || /^(true|false|null)$/i.test(s) || /^['"`]/.test(s)) return s;
  return str(s);
}

const settingKey = (s: string) => {
  const colon = findTop(s, ':');
  return (colon >= 0 ? s.slice(0, colon) : s).trim().toLowerCase().replace(/\s+/g, ' ');
};

/** Replaces (in place) or removes every setting whose key is one of `keys`. */
function setSetting(settings: string[], keys: string[], text: string | null): string[] {
  const at = settings.findIndex((s) => keys.includes(settingKey(s)));
  const rest = settings.filter((s) => !keys.includes(settingKey(s)));
  if (text === null) return rest;
  rest.splice(at < 0 ? rest.length : Math.min(at, rest.length), 0, text);
  return rest;
}

const bracket = (settings: string[]) => (settings.length ? ` [${settings.join(', ')}]` : '');

function lineStart(source: string, i: number) {
  return source.lastIndexOf('\n', i - 1) + 1;
}

function indentAt(source: string, i: number) {
  const s = lineStart(source, i);
  return /^[ \t]*/.exec(source.slice(s, i))![0];
}

/** A removal that takes the whole line(s) with it when nothing else is on them. */
function removal(source: string, loc: Loc): Change {
  let { start, end } = loc;
  const ls = lineStart(source, start);
  const before = source.slice(ls, start);
  let le = source.indexOf('\n', end);
  if (le < 0) le = source.length;
  const after = source.slice(end, le);
  if (!before.trim() && !after.trim()) {
    start = ls;
    end = Math.min(le + 1, source.length);
    // don't leave two blank lines behind
    const prevBlank = ls >= 2 && source[ls - 1] === '\n' && source[ls - 2] === '\n';
    const nextBlank = source[end] === '\n' || (end >= source.length && prevBlank);
    if ((prevBlank || ls === 0) && nextBlank) end = Math.min(end + 1, source.length);
  }
  return { start, end, text: '' };
}

function appendBlock(source: string, block: string): string {
  if (!source.trim()) return `${block}\n`;
  const sep = source.endsWith('\n\n') ? '' : source.endsWith('\n') ? '\n' : '\n\n';
  return `${source}${sep}${block}\n`;
}

/** An insertion of a new top-level block right after `loc` (e.g. Records after its table). */
const blockAfter = (loc: Loc, block: string): Change => ({ start: loc.end, end: loc.end, text: `\n\n${block}` });

function uniqueName(base: string, taken: Set<string>) {
  for (let i = 1; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

const inside = (outer: Loc) => (l: Loc) => outer.start <= l.start && l.end <= outer.end;

// ---- model helpers ------------------------------------------------------------------------

function table(ctx: EditCtx, id: string): DTable {
  const t = ctx.model.tables.find((x) => x.id === id);
  if (!t || !ctx.info.tables[id]) throw new Error(`unknown table ${id}`);
  return t;
}

export const tableRefText = (t: Pick<DTable, 'schema' | 'name'>) => (t.schema ? `${ident(t.schema)}.` : '') + ident(t.name);

/** Parses `schema.name` (or just `name`) typed by the user. */
function parseTableName(input: string): { schema?: string; name: string } {
  const v = input.trim();
  const dot = v.indexOf('.');
  if (dot > 0 && !v.startsWith('"')) return { schema: v.slice(0, dot) === 'public' ? undefined : v.slice(0, dot), name: v.slice(dot + 1) };
  return { name: v.replace(/^"(.*)"$/, '$1') };
}

const idOf = (t: { schema?: string; name: string }) => (t.schema ? `${t.schema}.${t.name}` : t.name);

export function refOp(from: string, to: string): RefOp {
  const a = isMany(from);
  const b = isMany(to);
  return a && b ? '<>' : a ? '>' : b ? '<' : '-';
}

const flip = (op: RefOp): RefOp => (op === '>' ? '<' : op === '<' ? '>' : op);

// ---- blocks: tables and TablePartials share column / index / check editing ----------------

/** Block ids: a table id, or `partial:<name>`. Their column ids are `<block id>.<column>`. */
export const partialId = (name: string) => `partial:${name}`;
const isPartial = (blockId: string) => blockId.startsWith('partial:');

function blockInfo(ctx: EditCtx, blockId: string): BlockInfo {
  const b = isPartial(blockId) ? ctx.info.partials[blockId.slice(8)] : ctx.info.tables[blockId];
  if (!b) throw new Error(`unknown block ${blockId}`);
  return b;
}

/** Columns written in the block itself (a table's columns injected from partials are excluded). */
export function ownFields(ctx: Pick<EditCtx, 'model' | 'info'>, blockId: string): DField[] {
  if (isPartial(blockId)) return ctx.info.partials[blockId.slice(8)]?.fields ?? [];
  return ctx.model.tables.find((t) => t.id === blockId)?.fields.filter((f) => !ctx.info.injected[f.id]) ?? [];
}

function blockOfField(ctx: EditCtx, fieldId: string): string {
  if (fieldId.startsWith('partial:')) {
    const p = Object.keys(ctx.info.partials).filter((n) => fieldId.startsWith(`partial:${n}.`)).sort((a, b) => b.length - a.length)[0];
    if (p !== undefined) return partialId(p);
  } else {
    const t = ctx.model.tables.find((x) => x.fields.some((f) => f.id === fieldId));
    if (t) return t.id;
  }
  throw new Error(`unknown field ${fieldId}`);
}

const fieldName = (fieldId: string, blockId: string) => fieldId.slice(blockId.length + 1);

/** Tables that inject a partial. */
const tablesUsing = (ctx: EditCtx, partial: string) =>
  Object.entries(ctx.info.tables).filter(([, t]) => t.partials.some((p) => p.name === partial)).map(([id]) => id);

/** The ids a column has in the model: itself, or for a partial column its copy in every table using it. */
function modelIds(ctx: EditCtx, fieldId: string, blockId: string): string[] {
  if (!isPartial(blockId)) return [fieldId];
  const name = fieldName(fieldId, blockId);
  return tablesUsing(ctx, blockId.slice(8)).map((t) => `${t}.${name}`);
}

function bodyOpen(ctx: EditCtx, blockId: string) {
  const b = blockInfo(ctx, blockId);
  return findTop(ctx.source, '{', b.loc.start, b.loc.end);
}

function bodyIndent(ctx: EditCtx, blockId: string) {
  const f = ownFields(ctx, blockId).map((x) => ctx.info.fields[x.id]).find(Boolean) ?? blockInfo(ctx, blockId).partials[0]?.loc;
  return f ? indentAt(ctx.source, f.start) || '  ' : '  ';
}

/** Inserts lines into a block body: after `afterLoc` if given, else right after the `{`. */
function insertInBody(ctx: EditCtx, blockId: string, lines: string, afterLoc?: Loc): Change {
  const b = blockInfo(ctx, blockId);
  if (afterLoc) {
    const le = ctx.source.indexOf('\n', afterLoc.end);
    const at = le < 0 || le > b.loc.end ? afterLoc.end : le;
    return { start: at, end: at, text: `\n${lines}` };
  }
  const open = bodyOpen(ctx, blockId);
  const inner = ctx.source.slice(open + 1, b.loc.end - 1);
  return { start: open + 1, end: open + 1, text: `\n${lines}${inner.includes('\n') ? '' : '\n'}` };
}

/** Where new columns go: after the last own column, else after the last `~partial`, else first. */
const lastColumnLoc = (ctx: EditCtx, blockId: string) =>
  [...ownFields(ctx, blockId)].reverse().map((f) => ctx.info.fields[f.id]).find(Boolean) ?? blockInfo(ctx, blockId).partials.at(-1)?.loc;

/** Header of a Table / TablePartial: `<kw> <name> [as alias] [settings]` up to the `{`. */
function parseHeader(ctx: EditCtx, blockId: string) {
  const b = blockInfo(ctx, blockId);
  const open = bodyOpen(ctx, blockId);
  const header = ctx.source.slice(b.loc.start, open);
  const kwm = /^\s*(TablePartial|Table)\s+/i.exec(header)!;
  let i = kwm[0].length;
  while (i < header.length && !/[\s[{]/.test(header[i])) i = header[i] === '"' ? skip(header, i) : i + 1;
  const br = findTop(header, '[', i);
  return {
    loc: { start: b.loc.start, end: open },
    keyword: kwm[1],
    name: header.slice(kwm[0].length, i),
    alias: header.slice(i, br < 0 ? header.length : br).trim(),
    settings: br < 0 ? [] : splitTop(header.slice(br + 1, findTop(header, ']', br + 1))),
  };
}

/** Note and header colour of a Table / TablePartial: header settings, or the `Note:` line in the body. */
function noteAndColor(ctx: EditCtx, blockId: string, settings: string[], patch: { note?: string; headerColor?: string }) {
  const changes: Change[] = [];
  const b = blockInfo(ctx, blockId);
  if (patch.headerColor !== undefined) settings = setSetting(settings, ['headercolor'], patch.headerColor ? `headercolor: ${patch.headerColor}` : null);
  if (patch.note !== undefined) {
    const nl = b.noteLoc;
    if (nl && nl.start > bodyOpen(ctx, blockId)) {
      if (patch.note) changes.push({ ...nl, text: `Note: ${str(patch.note)}` });
      else changes.push(removal(ctx.source, nl));
    } else {
      settings = setSetting(settings, ['note'], patch.note ? `note: ${str(patch.note)}` : null);
    }
  }
  return { settings, changes };
}

// ---- refs: text --------------------------------------------------------------------------

/** Renames applied while rendering refs/groups/records, so dependent text follows a rename. */
interface Names {
  table?: Record<string, { schema?: string; name: string }>;
  field?: Record<string, string>;
}

function endpointText(ctx: EditCtx, e: DEndpoint, names: Names = {}) {
  const t = table(ctx, e.tableId);
  const tn = names.table?.[t.id] ?? t;
  const cols = e.fieldIds.map((f) => ident(names.field?.[f] ?? fieldName(f, t.id)));
  return `${tableRefText(tn)}.${cols.length === 1 ? cols[0] : `(${cols.join(', ')})`}`;
}

interface RefSpec {
  name?: string;
  from: DEndpoint;
  to: DEndpoint;
  op: RefOp;
  onDelete?: string;
  onUpdate?: string;
  color?: string;
  inactive?: boolean;
}

function refStatement(ctx: EditCtx, r: RefSpec, names?: Names) {
  const settings = [r.onDelete && `delete: ${r.onDelete}`, r.onUpdate && `update: ${r.onUpdate}`, r.color && `color: ${r.color}`, r.inactive && 'inactive'].filter(Boolean) as string[];
  return `Ref${r.name ? ` ${ident(r.name)}` : ''}: ${endpointText(ctx, r.from, names)} ${r.op} ${endpointText(ctx, r.to, names)}${bracket(settings)}`;
}

const specOf = (ctx: EditCtx, ref: DRef): RefSpec => {
  const ri = ctx.info.refs[ref.id];
  return { name: ref.name, from: ref.from, to: ref.to, op: refOp(ref.from.relation, ref.to.relation), onDelete: ri?.onDelete, onUpdate: ri?.onUpdate, color: ri?.color ?? ref.color, inactive: ref.inactive };
};

/** The owner's own endpoint and the other one, for an inline ref. */
function inlineSides(ctx: EditCtx, ref: DRef) {
  const owner = ctx.info.refs[ref.id]?.ownerFieldId;
  return ref.to.fieldIds.includes(owner!) ? { own: ref.to, other: ref.from } : { own: ref.from, other: ref.to };
}

function inlineRefText(ctx: EditCtx, ref: DRef, names?: Names) {
  const { own, other } = inlineSides(ctx, ref);
  return `ref: ${refOp(own.relation, other.relation)} ${endpointText(ctx, other, names)}`;
}

/** Text that a ref should have after renames (whole statement, or just the inline setting). */
function refRewrite(ctx: EditCtx, ref: DRef, names: Names): Change {
  const ri = ctx.info.refs[ref.id];
  return { ...ri.loc, text: ri.inline ? inlineRefText(ctx, ref, names) : refStatement(ctx, specOf(ctx, ref), names) };
}

// ---- field text ---------------------------------------------------------------------------

const fieldText = (p: FieldParts) => `${p.name} ${p.type}${bracket(p.settings)}`;

function fieldParts(ctx: EditCtx, fieldId: string) {
  const loc = ctx.info.fields[fieldId];
  if (!loc) throw new Error(`unknown field ${fieldId}`);
  return { loc, parts: parseField(ctx.source.slice(loc.start, loc.end)) };
}

/** Removes inline `ref:` settings (given by their exact text) from a field. */
function withoutSettings(ctx: EditCtx, fieldId: string, drop: string[]): Change {
  const { loc, parts } = fieldParts(ctx, fieldId);
  const set = new Set(drop.map((d) => d.trim()));
  return { ...loc, text: fieldText({ ...parts, settings: parts.settings.filter((s) => !set.has(s.trim())) }) };
}

const refText = (ctx: EditCtx, refId: string) => {
  const l = ctx.info.refs[refId].loc;
  return ctx.source.slice(l.start, l.end);
};

/**
 * Changes that remove refs: standalone statements are deleted, inline settings are dropped from
 * their field (several refs on one field become one change). Refs whose location `ignore`
 * matches are inside something being removed anyway.
 */
function refRemovals(ctx: EditCtx, refs: DRef[], ignore: (loc: Loc) => boolean = () => false): Change[] {
  const out: Change[] = [];
  const byField = new Map<string, string[]>();
  for (const r of refs) {
    const ri = ctx.info.refs[r.id];
    if (!ri || ignore(ri.loc)) continue;
    if (ri.inline) byField.set(ri.ownerFieldId!, [...(byField.get(ri.ownerFieldId!) ?? []), refText(ctx, r.id)]);
    else out.push(removal(ctx.source, ri.loc));
  }
  for (const [fid, drop] of byField) {
    if (!ignore(ctx.info.fields[fid])) out.push(withoutSettings(ctx, fid, drop));
  }
  return out;
}

const refsTouching = (ctx: EditCtx, fieldIds: string[]) =>
  ctx.model.refs.filter((r) => [...r.from.fieldIds, ...r.to.fieldIds].some((f) => fieldIds.includes(f)));

// ---- records text -------------------------------------------------------------------------

/** `rows` are DBML literals (see `literalFor`); an empty cell is null. */
function recordsBlock(t: { schema?: string; name: string }, columns: string[], rows: string[][], example = false) {
  const body = rows.map((r) => `  ${r.map((c) => (c.trim() === '' ? 'null' : c)).join(', ')}`).join('\n');
  return `Records ${tableRefText(t)}(${columns.map(ident).join(', ')})${example ? ' [example]' : ''} {\n${body}${body ? '\n' : ''}}`;
}

/**
 * Rewrites a table's records after a rename or a removed column. Inline `records { … }` follow
 * the table's columns implicitly, so they only change when a column goes away.
 */
function recordsRewrite(ctx: EditCtx, tableId: string, opts: { names?: Names; dropColumn?: string; renameColumn?: [string, string] }): Change[] {
  const t = table(ctx, tableId);
  const tn = opts.names?.table?.[tableId] ?? t;
  return blockInfo(ctx, tableId).records.map((rec) => {
    let { columns, raw: rows } = rec;
    const drop = opts.dropColumn !== undefined ? columns.indexOf(opts.dropColumn) : -1;
    if (drop >= 0) {
      columns = columns.filter((_, i) => i !== drop);
      rows = rows.map((r) => r.filter((_, i) => i !== drop));
    }
    if (opts.renameColumn) columns = columns.map((c) => (c === opts.renameColumn![0] ? opts.renameColumn![1] : c));
    if (!columns.length) return removal(ctx.source, rec.loc);
    if (rec.inline && drop < 0) return { ...rec.loc, text: ctx.source.slice(rec.loc.start, rec.loc.end) };
    if (rec.inline) {
      const ind = indentAt(ctx.source, rec.loc.start);
      return { ...rec.loc, text: `records {\n${rows.map((r) => `${ind}  ${r.join(', ')}`).join('\n')}\n${ind}}` };
    }
    return { ...rec.loc, text: recordsBlock(tn, columns, rows, rec.example) };
  });
}

// ---- index / check text -------------------------------------------------------------------

export function indexText(ix: Pick<DIndex, 'columns' | 'unique' | 'pk' | 'name' | 'type' | 'note'>) {
  const cols = ix.columns.map((c) => (c.startsWith('`') ? c : ident(c)));
  const settings = [ix.pk && 'pk', ix.unique && 'unique', ix.name && `name: ${str(ix.name)}`, ix.type && `type: ${ix.type}`, ix.note && `note: ${str(ix.note)}`].filter(Boolean) as string[];
  return `${cols.length === 1 && !ix.columns[0].startsWith('`') ? cols[0] : `(${cols.join(', ')})`}${bracket(settings)}`;
}

const checkText = (c: { expression: string; name?: string }) => `${expr(c.expression)}${c.name ? ` [name: ${str(c.name)}]` : ''}`;

/** Range of a whole `Indexes { … }` / `checks { … }` block, from the location of its first entry. */
function subBlock(ctx: EditCtx, blockId: string, keyword: 'Indexes' | 'checks', first: Loc | undefined): Loc | undefined {
  if (!first) return undefined;
  const b = blockInfo(ctx, blockId);
  const kw = ctx.source.slice(b.loc.start, first.start).search(new RegExp(`${keyword}\\s*\\{[^{]*$`, 'i'));
  if (kw < 0) return undefined;
  const start = b.loc.start + kw;
  const open = ctx.source.indexOf('{', start);
  const close = findTop(ctx.source, '}', open + 1);
  return close < 0 ? undefined : { start, end: close + 1 };
}

/** Adds an entry to the block's `Indexes` / `checks` sub-block, creating the sub-block if needed. */
function addSubEntry(ctx: EditCtx, blockId: string, keyword: 'Indexes' | 'checks', existing: Loc[], text: string): Change {
  const last = existing.at(-1);
  if (last) return { start: last.end, end: last.end, text: `\n${indentAt(ctx.source, last.start)}${text}` };
  const b = blockInfo(ctx, blockId);
  const ind = bodyIndent(ctx, blockId);
  // after the other sub-block if there is one, else after the columns
  const other = keyword === 'checks' ? subBlock(ctx, blockId, 'Indexes', b.indexes[0]?.loc) : undefined;
  return insertInBody(ctx, blockId, `\n${ind}${keyword} {\n${ind}${ind}${text}\n${ind}}`, other ?? lastColumnLoc(ctx, blockId));
}

// ---- tables -------------------------------------------------------------------------------

export function addTable(ctx: EditCtx): EditResult {
  const name = uniqueName('table', new Set(ctx.model.tables.map((t) => t.id)));
  return { source: appendBlock(ctx.source, `Table ${name} {\n  id integer [pk, increment]\n}`), created: name };
}

interface TablePatch {
  /** `name` or `schema.name` */
  name?: string;
  /** short name usable in refs; empty string removes it */
  alias?: string;
  /** empty string removes it */
  note?: string;
  /** `#rrggbb`; empty string removes it */
  headerColor?: string;
}

export function updateTable(ctx: EditCtx, tableId: string, patch: TablePatch): EditResult {
  const t = table(ctx, tableId);
  const h = parseHeader(ctx, tableId);
  const nc = noteAndColor(ctx, tableId, h.settings, patch);
  const changes = nc.changes;

  const next = patch.name !== undefined && patch.name.trim() ? parseTableName(patch.name) : undefined;
  const renamed = next && idOf(next) !== tableId ? next : undefined;
  if (renamed && ctx.model.tables.some((x) => x.id === idOf(renamed))) throw new EditError('duplicate', idOf(renamed));
  let alias = h.alias;
  if (patch.alias !== undefined) alias = patch.alias.trim() ? `as ${ident(patch.alias.trim())}` : '';
  changes.push({ ...h.loc, text: `Table ${renamed ? tableRefText(renamed) : h.name}${alias ? ` ${alias}` : ''}${bracket(nc.settings)} ` });

  if (renamed) {
    const names: Names = { table: { [tableId]: renamed } };
    for (const r of ctx.model.refs) {
      if (r.from.tableId === tableId || r.to.tableId === tableId) changes.push(refRewrite(ctx, r, names));
    }
    for (const g of ctx.model.groups) {
      if (g.tableIds.includes(tableId)) changes.push(groupRewrite(ctx, g.id, {}, names));
    }
    changes.push(...recordsRewrite(ctx, t.id, { names }).filter((c) => !inside(blockInfo(ctx, tableId).loc)(c)));
    changes.push(...viewsRewrite(ctx, { tables: { [tableId]: renamed } }));
    changes.push(...depsRewrite(ctx, names, {}, tableId));
    changes.push(...metadataRewrite(ctx, { tables: { [tableId]: renamed } }));
    return { source: apply(ctx.source, changes), renamed: { [tableId]: idOf(renamed) } };
  }
  return { source: apply(ctx.source, changes) };
}

export function deleteTable(ctx: EditCtx, tableId: string): EditResult {
  table(ctx, tableId);
  const ti = ctx.info.tables[tableId];
  const refs = ctx.model.refs.filter((r) => r.from.tableId === tableId || r.to.tableId === tableId);
  const changes = [removal(ctx.source, ti.loc), ...refRemovals(ctx, refs, inside(ti.loc))];
  for (const rec of ti.records) if (!rec.inline) changes.push(removal(ctx.source, rec.loc));
  changes.push(...viewsRewrite(ctx, { tables: { [tableId]: null } }));
  changes.push(...depsRewrite(ctx, {}, { tables: [tableId] }, undefined, inside(ti.loc)));
  changes.push(...metadataRewrite(ctx, { tables: { [tableId]: null } }));
  for (const g of ctx.model.groups) {
    if (g.tableIds.includes(tableId)) changes.push(groupRewrite(ctx, g.id, { tableIds: g.tableIds.filter((x) => x !== tableId) }));
  }
  return { source: apply(ctx.source, changes), removed: [tableId] };
}

// ---- columns (of a table or a partial) ----------------------------------------------------

export function addField(ctx: EditCtx, blockId: string): EditResult {
  const all = isPartial(blockId) ? ownFields(ctx, blockId) : table(ctx, blockId).fields;
  const name = uniqueName('column', new Set(all.map((f) => f.name)));
  const change = insertInBody(ctx, blockId, `${bodyIndent(ctx, blockId)}${name} varchar`, lastColumnLoc(ctx, blockId));
  return { source: apply(ctx.source, [change]), created: `${blockId}.${name}` };
}

export function updateField(ctx: EditCtx, fieldId: string, patch: FieldPatch): EditResult {
  const blockId = blockOfField(ctx, fieldId);
  const { loc, parts } = fieldParts(ctx, fieldId);
  let { settings } = parts;
  const flag = (on: boolean | undefined, keys: string[], text: string) => {
    if (on !== undefined) settings = setSetting(settings, keys, on ? text : null);
  };
  flag(patch.pk, ['pk', 'primary key'], 'pk');
  flag(patch.increment, ['increment'], 'increment');
  flag(patch.notNull, ['not null', 'null'], 'not null');
  flag(patch.unique, ['unique'], 'unique');
  if (patch.defaultValue !== undefined || patch.defaultKind !== undefined) {
    const v = patch.defaultValue ?? '';
    const kind = patch.defaultKind;
    const text = kind === 'null' ? 'null'
      : !v.trim() ? null
      : kind === 'string' ? str(v)
      : kind === 'expression' ? expr(v)
      : kind === 'number' || kind === 'boolean' ? v.trim()
      : literal(v);
    settings = setSetting(settings, ['default'], text === null ? null : `default: ${text}`);
  }
  if (patch.note !== undefined) settings = setSetting(settings, ['note'], patch.note ? `note: ${str(patch.note)}` : null);
  if (patch.checks !== undefined) {
    const at = settings.findIndex((x) => settingKey(x) === 'check');
    const rest = settings.filter((x) => settingKey(x) !== 'check');
    rest.splice(at < 0 ? rest.length : Math.min(at, rest.length), 0, ...patch.checks.filter((c) => c.trim()).map((c) => `check: ${expr(c)}`));
    settings = rest;
  }
  if (patch.ref !== undefined) settings = setSetting(settings, ['ref'], patch.ref ? `ref: ${patch.ref.op} ${patch.ref.target.trim()}` : null);
  if (patch.custom !== undefined) {
    const builtin = ['pk', 'primary key', 'unique', 'ref', 'dep', 'not null', 'null', 'increment', 'default', 'note', 'check'];
    settings = [
      ...settings.filter((x) => builtin.includes(settingKey(x)) || findTop(x, ':') < 0),
      ...Object.entries(patch.custom).filter(([k]) => /^[A-Za-z_]\w*$/.test(k.trim())).map(([k, v]) => `${k.trim()}: ${/^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : str(v)}`),
    ];
  }

  const oldName = fieldName(fieldId, blockId);
  const newName = patch.name?.trim() && patch.name.trim() !== oldName ? patch.name.trim() : undefined;
  // a table's own column may take the name of one it gets from a partial: it then overrides it
  if (newName && ownFields(ctx, blockId).some((f) => f.name === newName)) throw new EditError('duplicate', newName);
  const changes: Change[] = [];

  if (newName) {
    // the column as the model knows it: itself, or its copy in every table using the partial
    const ids = modelIds(ctx, fieldId, blockId);
    const names: Names = { field: Object.fromEntries(ids.map((id) => [id, newName])) };
    // inline refs on this column live inside the line rewritten below
    const own = new Set(Object.entries(ctx.info.refs).filter(([, r]) => r.ownerFieldId === fieldId).map(([id]) => id));
    for (const r of refsTouching(ctx, ids)) if (!own.has(r.id)) changes.push(refRewrite(ctx, r, names));
    for (const ix of blockInfo(ctx, blockId).indexes) {
      if (ix.columns.includes(oldName)) changes.push({ ...ix.loc, text: indexText({ ...ix, columns: ix.columns.map((c) => (c === oldName ? newName : c)) }) });
    }
    const tables = isPartial(blockId) ? tablesUsing(ctx, blockId.slice(8)) : [blockId];
    for (const tid of tables) changes.push(...recordsRewrite(ctx, tid, { renameColumn: [oldName, newName] }).filter((c) => c.text !== ctx.source.slice(c.start, c.end)));
    changes.push(...depsRewrite(ctx, names, {}, fieldId, inside(loc)));
    changes.push(...metadataRewrite(ctx, { columns: Object.fromEntries(ids.map((id) => [id, newName])) }));
  }
  changes.push({ ...loc, text: fieldText({ name: newName ? ident(newName) : parts.name, type: patch.type !== undefined ? typeText(patch.type) : parts.type, settings }) });
  return { source: apply(ctx.source, changes), ...(newName ? { created: `${blockId}.${newName}` } : {}) };
}

export function deleteField(ctx: EditCtx, fieldId: string): EditResult {
  const blockId = blockOfField(ctx, fieldId);
  const name = fieldName(fieldId, blockId);
  const tables = isPartial(blockId) ? tablesUsing(ctx, blockId.slice(8)) : [blockId];
  // DBML has no empty tables (a partial on its own may be empty only if nothing uses it)
  if (tables.some((tid) => table(ctx, tid).fields.length <= 1) || (isPartial(blockId) && ownFields(ctx, blockId).length <= 1)) throw new EditError('lastColumn');
  const loc = ctx.info.fields[fieldId];
  const changes = [removal(ctx.source, loc), ...refRemovals(ctx, refsTouching(ctx, modelIds(ctx, fieldId, blockId)), inside(loc))];
  const b = blockInfo(ctx, blockId);
  const dropped = b.indexes.filter((ix) => ix.columns.includes(name));
  if (dropped.length && dropped.length === b.indexes.length) {
    const block = subBlock(ctx, blockId, 'Indexes', b.indexes[0].loc);
    if (block) changes.push(removal(ctx.source, block));
  } else {
    for (const ix of dropped) changes.push(removal(ctx.source, ix.loc));
  }
  for (const tid of tables) changes.push(...recordsRewrite(ctx, tid, { dropColumn: name }).filter((c) => c.text !== ctx.source.slice(c.start, c.end)));
  const ids = modelIds(ctx, fieldId, blockId);
  changes.push(...depsRewrite(ctx, {}, { fields: ids }, undefined, inside(loc)));
  changes.push(...metadataRewrite(ctx, { columns: Object.fromEntries(ids.map((id) => [id, null])) }));
  return { source: apply(ctx.source, changes) };
}

/** Swaps a column with its neighbour above (`-1`) or below (`1`) among the block's own columns. */
export function moveField(ctx: EditCtx, fieldId: string, dir: -1 | 1): EditResult {
  const fields = ownFields(ctx, blockOfField(ctx, fieldId));
  const i = fields.findIndex((f) => f.id === fieldId);
  const other = fields[i + dir];
  if (!other) return { source: ctx.source };
  const a = ctx.info.fields[fieldId];
  const b = ctx.info.fields[other.id];
  const text = (l: Loc) => ctx.source.slice(l.start, l.end);
  return { source: apply(ctx.source, [{ ...a, text: text(b) }, { ...b, text: text(a) }]) };
}

// ---- indexes ------------------------------------------------------------------------------

type IndexSpec = Pick<DIndex, 'columns'> & Partial<Pick<DIndex, 'unique' | 'pk' | 'name' | 'type' | 'note'>>;

export function addIndex(ctx: EditCtx, blockId: string, ix: IndexSpec): EditResult {
  const columns = ix.columns.map((c) => c.trim()).filter(Boolean);
  if (!columns.length) return { source: ctx.source };
  const text = indexText({ unique: false, pk: false, ...ix, columns });
  return { source: apply(ctx.source, [addSubEntry(ctx, blockId, 'Indexes', blockInfo(ctx, blockId).indexes.map((i) => i.loc), text)]) };
}

export function updateIndex(ctx: EditCtx, blockId: string, index: number, patch: Partial<IndexSpec>): EditResult {
  const ix = blockInfo(ctx, blockId).indexes[index];
  if (!ix) throw new Error('unknown index');
  const next = { ...ix, ...patch };
  for (const k of ['name', 'type', 'note'] as const) if (next[k] === '') next[k] = undefined;
  if (!next.columns.length) throw new EditError('columnCount');
  return { source: apply(ctx.source, [{ ...ix.loc, text: indexText(next) }]) };
}

export function deleteIndex(ctx: EditCtx, blockId: string, index: number): EditResult {
  const b = blockInfo(ctx, blockId);
  const ix = b.indexes[index];
  if (!ix) throw new Error('unknown index');
  const block = b.indexes.length === 1 ? subBlock(ctx, blockId, 'Indexes', ix.loc) : undefined;
  return { source: apply(ctx.source, [removal(ctx.source, block ?? ix.loc)]) };
}

// ---- checks -------------------------------------------------------------------------------

export function addCheck(ctx: EditCtx, blockId: string, c: { expression: string; name?: string }): EditResult {
  if (!c.expression.trim()) return { source: ctx.source };
  const change = addSubEntry(ctx, blockId, 'checks', blockInfo(ctx, blockId).checks.map((x) => x.loc), checkText(c));
  return { source: apply(ctx.source, [change]) };
}

export function updateCheck(ctx: EditCtx, blockId: string, index: number, patch: { expression?: string; name?: string }): EditResult {
  const c = blockInfo(ctx, blockId).checks[index];
  if (!c) throw new Error('unknown check');
  const next = { expression: patch.expression?.trim() || c.expression, name: patch.name !== undefined ? patch.name.trim() || undefined : c.name };
  return { source: apply(ctx.source, [{ ...c.loc, text: checkText(next) }]) };
}

export function deleteCheck(ctx: EditCtx, blockId: string, index: number): EditResult {
  const b = blockInfo(ctx, blockId);
  const c = b.checks[index];
  if (!c) throw new Error('unknown check');
  const block = b.checks.length === 1 ? subBlock(ctx, blockId, 'checks', c.loc) : undefined;
  return { source: apply(ctx.source, [removal(ctx.source, block ?? c.loc)]) };
}

// ---- refs ---------------------------------------------------------------------------------

const endpoint = (ctx: EditCtx, fieldIds: string[]): DEndpoint => {
  const tid = blockOfField(ctx, fieldIds[0]);
  return { tableId: tid, fieldIds, relation: '' };
};

/**
 * Adds `Ref: from > to` (from references to). `from`/`to` are column ids — several for a
 * composite key, pairwise in the same order on both sides.
 */
export function addRef(ctx: EditCtx, from: string | string[], to: string | string[], op: RefOp = '>', name?: string): EditResult {
  const a = Array.isArray(from) ? from : [from];
  const b = Array.isArray(to) ? to : [to];
  if (!a.length || a.length !== b.length) throw new EditError('columnCount');
  const stmt = refStatement(ctx, { name: name?.trim() || undefined, from: endpoint(ctx, a), to: endpoint(ctx, b), op });
  // consecutive Ref lines stay together; anything else gets a blank line before
  const body = ctx.source.replace(/\s*$/, '');
  const lastLine = body.slice(body.lastIndexOf('\n') + 1);
  const sep = !body ? '' : /^\s*Ref\b/i.test(lastLine) ? '\n' : '\n\n';
  return { source: `${body}${sep}${stmt}\n` };
}

interface RefPatch {
  op?: RefOp;
  /** empty string removes the action */
  onDelete?: string;
  onUpdate?: string;
  /** empty string removes it */
  name?: string;
  color?: string;
  /** `[inactive]`: kept as documentation, not enforced */
  inactive?: boolean;
  /** new column ids for either end (same count on both ends) */
  from?: string[];
  to?: string[];
  /** exchange the two ends (`a > b` becomes `b < a`) */
  swap?: boolean;
}

export function updateRef(ctx: EditCtx, refId: string, patch: RefPatch): EditResult {
  const ref = ctx.model.refs.find((r) => r.id === refId);
  const ri = ctx.info.refs[refId];
  if (!ref || !ri) throw new Error(`unknown ref ${refId}`);
  if (ri.ownerFieldId?.startsWith('partial:')) throw new EditError('partialRef', ri.ownerFieldId.slice(8));
  const cur = specOf(ctx, ref);
  const spec: RefSpec = {
    name: patch.name !== undefined ? patch.name.trim() || undefined : cur.name,
    from: patch.from ? endpoint(ctx, patch.from) : cur.from,
    to: patch.to ? endpoint(ctx, patch.to) : cur.to,
    op: patch.op ?? cur.op,
    onDelete: patch.onDelete !== undefined ? patch.onDelete || undefined : cur.onDelete,
    onUpdate: patch.onUpdate !== undefined ? patch.onUpdate || undefined : cur.onUpdate,
    color: patch.color !== undefined ? patch.color || undefined : cur.color,
    inactive: patch.inactive !== undefined ? patch.inactive : cur.inactive,
  };
  if (!spec.from.fieldIds.length || spec.from.fieldIds.length !== spec.to.fieldIds.length) throw new EditError('columnCount');
  if (patch.swap) [spec.from, spec.to, spec.op] = [spec.to, spec.from, flip(spec.op)];

  if (ri.inline) {
    const sameEnds = !patch.from && !patch.to && !patch.swap;
    if (sameEnds && !spec.name && !spec.onDelete && !spec.onUpdate && !spec.color && !spec.inactive) {
      // stays inline: `ref: <op> other`, op seen from the owning column
      const { own, other } = inlineSides(ctx, ref);
      const ownOp = own === ref.from ? spec.op : flip(spec.op);
      return { source: apply(ctx.source, [{ ...ri.loc, text: `ref: ${ownOp} ${endpointText(ctx, other)}` }]) };
    }
    // inline refs can't carry names, actions, colours, inactive or several columns: move it to a Ref
    // statement, written from the column it was on (`a.x [ref: > b.y]` → `Ref: a.x > b.y`)
    if (!patch.swap && !patch.from && !patch.to && inlineSides(ctx, ref).own === ref.to) [spec.from, spec.to, spec.op] = [spec.to, spec.from, flip(spec.op)];
    const removed = apply(ctx.source, [withoutSettings(ctx, ri.ownerFieldId!, [refText(ctx, refId)])]);
    return { source: appendBlock(removed, refStatement(ctx, spec)) };
  }
  return { source: apply(ctx.source, [{ ...ri.loc, text: refStatement(ctx, spec) }]) };
}

export function deleteRef(ctx: EditCtx, refId: string): EditResult {
  const ref = ctx.model.refs.find((r) => r.id === refId);
  if (!ref) throw new Error(`unknown ref ${refId}`);
  const owner = ctx.info.refs[refId]?.ownerFieldId;
  if (owner?.startsWith('partial:')) throw new EditError('partialRef', owner.slice(8));
  return { source: apply(ctx.source, refRemovals(ctx, [ref])) };
}

// ---- table partials -----------------------------------------------------------------------

export function addPartial(ctx: EditCtx): EditResult {
  const name = uniqueName('partial', new Set(Object.keys(ctx.info.partials)));
  return { source: appendBlock(ctx.source, `TablePartial ${name} {\n  id integer [pk, increment]\n}`), created: partialId(name) };
}

export function updatePartial(ctx: EditCtx, name: string, patch: { name?: string; note?: string; headerColor?: string }): EditResult {
  const id = partialId(name);
  const h = parseHeader(ctx, id);
  const nc = noteAndColor(ctx, id, h.settings, patch);
  const next = patch.name?.trim() && patch.name.trim() !== name ? patch.name.trim() : undefined;
  if (next && ctx.info.partials[next]) throw new EditError('duplicate', next);
  const changes = [...nc.changes, { ...h.loc, text: `TablePartial ${next ? ident(next) : h.name}${bracket(nc.settings)} ` }];
  if (next) {
    for (const t of Object.values(ctx.info.tables)) {
      for (const p of t.partials) if (p.name === name) changes.push({ ...p.loc, text: `~${ident(next)}` });
    }
  }
  return { source: apply(ctx.source, changes), ...(next ? { created: partialId(next) } : {}) };
}

/** Columns a table would lose (and whether it would be left empty) without a partial. */
function withoutPartial(ctx: EditCtx, tableId: string, name: string) {
  const t = table(ctx, tableId);
  const lost = t.fields.filter((f) => ctx.info.injected[f.id] === name).map((f) => f.id);
  if (lost.length >= t.fields.length) throw new EditError('lastColumn');
  return lost;
}

export function deletePartial(ctx: EditCtx, name: string): EditResult {
  const p = ctx.info.partials[name];
  if (!p) throw new Error(`unknown partial ${name}`);
  const changes: Change[] = [removal(ctx.source, p.loc)];
  const lost: string[] = [];
  for (const [tid, t] of Object.entries(ctx.info.tables)) {
    for (const inj of t.partials) {
      if (inj.name !== name) continue;
      lost.push(...withoutPartial(ctx, tid, name));
      changes.push(removal(ctx.source, inj.loc));
    }
  }
  changes.push(...refRemovals(ctx, refsTouching(ctx, lost), inside(p.loc)));
  return { source: apply(ctx.source, changes) };
}

/** Makes a table include a partial's columns and settings (`~partial` at the top of its body). */
export function addPartialToTable(ctx: EditCtx, tableId: string, name: string): EditResult {
  table(ctx, tableId);
  if (!ctx.info.partials[name] || ctx.info.tables[tableId].partials.some((p) => p.name === name)) return { source: ctx.source };
  const last = ctx.info.tables[tableId].partials.at(-1)?.loc;
  return { source: apply(ctx.source, [insertInBody(ctx, tableId, `${bodyIndent(ctx, tableId)}~${ident(name)}`, last)]) };
}

/**
 * Moves a `~partial` among the table's columns and other injections (its position sets where the
 * partial's columns appear): swaps it with the item above (`-1`) or below (`1`).
 */
export function moveInjection(ctx: EditCtx, tableId: string, name: string, dir: -1 | 1): EditResult {
  const ti = ctx.info.tables[tableId];
  const inj = ti?.partials.find((p) => p.name === name);
  if (!inj) return { source: ctx.source };
  const items = [...ownFields(ctx, tableId).map((f) => ctx.info.fields[f.id]).filter(Boolean), ...ti.partials.map((p) => p.loc)].sort((a, b) => a.start - b.start);
  const i = items.findIndex((l) => l.start === inj.loc.start);
  const other = items[i + dir];
  if (!other) return { source: ctx.source };
  const text = (l: Loc) => ctx.source.slice(l.start, l.end);
  return { source: apply(ctx.source, [{ ...inj.loc, text: text(other) }, { ...other, text: text(inj.loc) }]) };
}

export function removePartialFromTable(ctx: EditCtx, tableId: string, name: string): EditResult {
  const inj = ctx.info.tables[tableId]?.partials.find((p) => p.name === name);
  if (!inj) return { source: ctx.source };
  const lost = withoutPartial(ctx, tableId, name);
  return { source: apply(ctx.source, [removal(ctx.source, inj.loc), ...refRemovals(ctx, refsTouching(ctx, lost))]) };
}

// ---- records (sample data) ----------------------------------------------------------------

/**
 * Writes a table's sample data block `index` (or a new one after the table when `index` is -1).
 * Cells are DBML literals (the UI makes them with `literalFor`, so untouched cells keep exactly
 * what was written); an empty cell is null. `columns` may be any subset of the table's columns.
 * Inline `records { }` are rewritten as a standalone `Records t(cols)` block.
 */
export function setRecords(ctx: EditCtx, tableId: string, index: number, data: { columns: string[]; rows: string[][]; example?: boolean }): EditResult {
  const t = table(ctx, tableId);
  const ti = ctx.info.tables[tableId];
  if (!data.columns.length) throw new EditError('columnCount');
  const rec = ti.records[index];
  // DBML allows one Records block per table
  if (!rec && ti.records.length) throw new EditError('oneRecords');
  const block = recordsBlock(t, data.columns, data.rows, data.example ?? rec?.example ?? false);
  if (!rec) return { source: apply(ctx.source, [blockAfter(ti.loc, block)]) };
  if (!rec.inline) return { source: apply(ctx.source, [{ ...rec.loc, text: block }]) };
  return { source: apply(ctx.source, [removal(ctx.source, rec.loc), blockAfter(ti.loc, block)]) };
}

export function deleteRecords(ctx: EditCtx, tableId: string, index: number): EditResult {
  const rec = ctx.info.tables[tableId]?.records[index];
  if (!rec) throw new Error('unknown records');
  return { source: apply(ctx.source, [removal(ctx.source, rec.loc)]) };
}

// ---- project ------------------------------------------------------------------------------

export const DATABASE_TYPES = ['PostgreSQL', 'MySQL', 'SQL Server', 'Oracle', 'Snowflake', 'SQLite'] as const;

/**
 * Creates the `Project` block, or changes its name, database type and note in place — other
 * entries someone wrote there stay as they are.
 */
export function setProject(ctx: EditCtx, patch: { name?: string; databaseType?: string; note?: string; custom?: Record<string, string> }): EditResult {
  const cur = ctx.model.project ?? {};
  const name = (patch.name !== undefined ? patch.name : cur.name)?.trim() || 'project';
  const dbType = patch.databaseType !== undefined ? patch.databaseType.trim() : cur.databaseType;
  const note = patch.note !== undefined ? patch.note : cur.note;
  const loc = ctx.info.project;
  if (!loc) {
    const custom = Object.entries(patch.custom ?? {}).filter(([k]) => k.trim()).map(([k, v]) => `  ${k.trim()}: ${str(v)}`);
    const lines = [dbType && `  database_type: ${str(dbType)}`, note && `  Note: ${str(note)}`, ...custom].filter(Boolean);
    // a new Project goes first, as is customary
    return { source: `Project ${ident(name)} {\n${lines.join('\n')}${lines.length ? '\n' : ''}}\n\n${ctx.source.replace(/^\n+/, '')}` };
  }
  const open = findTop(ctx.source, '{', loc.start, loc.end);
  const body = ctx.source.slice(open + 1, loc.end - 1);
  const stmts = bodyStatements(body);
  const keyOf = (st: string) => settingKey(st.trim().startsWith('Note') && !st.includes(':') ? 'note:' : st);
  const ind = stmts[0] ? /^[ \t]*/.exec(stmts[0].text)![0] || '  ' : '  ';
  const kept = patch.custom
    ? Object.entries(patch.custom).filter(([k]) => k.trim()).map(([k, v]) => `${ind}${k.trim()}: ${str(v)}`)
    : stmts.filter((st) => !['database_type', 'note'].includes(keyOf(st.text))).map((st) => st.text);
  const lines = [...(dbType ? [`${ind}database_type: ${str(dbType)}`] : []), ...(note ? [`${ind}Note: ${str(note)}`] : []), ...kept];
  return { source: apply(ctx.source, [{ ...loc, text: `Project ${ident(name)} {\n${lines.join('\n')}${lines.length ? '\n' : ''}}` }]) };
}

export function deleteProject(ctx: EditCtx): EditResult {
  const loc = ctx.info.project;
  return loc ? { source: apply(ctx.source, [removal(ctx.source, loc)]) } : { source: ctx.source };
}

// ---- enums --------------------------------------------------------------------------------

export interface EnumValue { name: string; note?: string }

function enumBlock(name: string, values: EnumValue[]) {
  const lines = values.filter((v) => v.name.trim()).map((v) => `  ${ident(v.name.trim())}${v.note ? ` [note: ${str(v.note)}]` : ''}`);
  return `Enum ${name} {\n${lines.join('\n')}\n}`;
}

export function addEnum(ctx: EditCtx): EditResult {
  const name = uniqueName('enum', new Set(ctx.model.enums.map((e) => e.id)));
  return { source: appendBlock(ctx.source, enumBlock(name, [{ name: 'value_1' }, { name: 'value_2' }])), created: name };
}

export function updateEnum(ctx: EditCtx, enumId: string, patch: { name?: string; values?: EnumValue[] }): EditResult {
  const e = ctx.model.enums.find((x) => x.id === enumId);
  const loc = ctx.info.enums[enumId];
  if (!e || !loc) throw new Error(`unknown enum ${enumId}`);
  const next = patch.name?.trim() ? parseTableName(patch.name) : parseTableName(enumId);
  const nextId = idOf(next);
  if (nextId !== enumId && ctx.model.enums.some((x) => x.id === nextId)) throw new EditError('duplicate', nextId);
  const values = patch.values ?? e.values;
  if (!values.some((v) => v.name.trim())) throw new EditError('emptyEnum');
  const changes: Change[] = [{ ...loc, text: enumBlock(tableRefText(next), values) }];
  if (nextId !== enumId) {
    // columns of this enum type follow the rename
    for (const t of ctx.model.tables) {
      for (const f of t.fields) {
        if (f.enumId !== enumId || !ctx.info.fields[f.id]) continue;
        const { loc: fl, parts } = fieldParts(ctx, f.id);
        changes.push({ ...fl, text: fieldText({ ...parts, type: tableRefText(next) }) });
      }
    }
  }
  return { source: apply(ctx.source, changes) };
}

export function deleteEnum(ctx: EditCtx, enumId: string): EditResult {
  const loc = ctx.info.enums[enumId];
  if (!loc) throw new Error(`unknown enum ${enumId}`);
  return { source: apply(ctx.source, [removal(ctx.source, loc)]) };
}

// ---- sticky notes -------------------------------------------------------------------------

function noteBlock(name: string, content: string, color?: string) {
  return `Note ${ident(name)}${color ? ` [color: ${color}]` : ''} {\n  ${str(content)}\n}`;
}

export function addNote(ctx: EditCtx, content = ''): EditResult {
  const name = uniqueName('note', new Set(ctx.model.notes.map((n) => n.name)));
  return { source: appendBlock(ctx.source, noteBlock(name, content)), created: `note:${name}` };
}

export function updateNote(ctx: EditCtx, noteId: string, patch: { name?: string; content?: string; color?: string }): EditResult {
  const n = ctx.model.notes.find((x) => x.id === noteId);
  const loc = ctx.info.notes[noteId];
  if (!n || !loc) throw new Error(`unknown note ${noteId}`);
  const name = patch.name?.trim() || n.name;
  if (name !== n.name && ctx.model.notes.some((x) => x.name === name)) throw new EditError('duplicate', name);
  const color = patch.color !== undefined ? patch.color || undefined : n.color;
  const changes = [{ ...loc, text: noteBlock(name, patch.content ?? n.content, color) }];
  if (name !== n.name) changes.push(...viewsRewrite(ctx, { notes: { [noteId]: name } }), ...metadataRewrite(ctx, { notes: { [noteId]: name } }));
  const source = apply(ctx.source, changes);
  return name !== n.name ? { source, renamed: { [noteId]: `note:${name}` } } : { source };
}

export function deleteNote(ctx: EditCtx, noteId: string): EditResult {
  const loc = ctx.info.notes[noteId];
  if (!loc) throw new Error(`unknown note ${noteId}`);
  return { source: apply(ctx.source, [removal(ctx.source, loc), ...viewsRewrite(ctx, { notes: { [noteId]: null } }), ...metadataRewrite(ctx, { notes: { [noteId]: null } })]), removed: [noteId] };
}

// ---- table groups -------------------------------------------------------------------------

interface GroupPatch {
  name?: string;
  /** empty string removes it */
  color?: string;
  note?: string;
  tableIds?: string[];
}

function groupBlock(ctx: EditCtx, g: { name: string; color?: string; note?: string; tableIds: string[] }, names: Names = {}) {
  const members = g.tableIds.map((id) => `  ${tableRefText(names.table?.[id] ?? table(ctx, id))}`);
  const lines = [...members, ...(g.note ? [`  Note: ${str(g.note)}`] : [])];
  return `TableGroup ${ident(g.name)}${g.color ? ` [color: ${g.color}]` : ''} {\n${lines.join('\n')}\n}`;
}

function groupRewrite(ctx: EditCtx, groupId: string, patch: GroupPatch, names?: Names): Change {
  const g = ctx.model.groups.find((x) => x.id === groupId);
  const loc = ctx.info.groups[groupId];
  if (!g || !loc) throw new Error(`unknown group ${groupId}`);
  const next = {
    name: patch.name?.trim() || g.name,
    color: patch.color !== undefined ? patch.color || undefined : g.color,
    note: patch.note !== undefined ? patch.note || undefined : g.note,
    tableIds: patch.tableIds ?? g.tableIds,
  };
  return { ...loc, text: groupBlock(ctx, next, names) };
}

/** A table belongs to at most one group: taking tables into one removes them from the others. */
function releaseFromOtherGroups(ctx: EditCtx, tableIds: string[], except?: string): Change[] {
  return ctx.model.groups
    .filter((g) => g.id !== except && g.tableIds.some((id) => tableIds.includes(id)))
    .map((g) => groupRewrite(ctx, g.id, { tableIds: g.tableIds.filter((id) => !tableIds.includes(id)) }));
}

export function addGroup(ctx: EditCtx, tableIds: string[]): EditResult {
  const name = uniqueName('group', new Set(ctx.model.groups.map((g) => g.name)));
  const source = apply(ctx.source, releaseFromOtherGroups(ctx, tableIds));
  return { source: appendBlock(source, groupBlock(ctx, { name, tableIds })), created: `group:${name}` };
}

export function updateGroup(ctx: EditCtx, groupId: string, patch: GroupPatch): EditResult {
  const name = patch.name?.trim();
  const g = ctx.model.groups.find((x) => x.id === groupId);
  if (name && name !== g?.name && ctx.model.groups.some((x) => x.name === name)) throw new EditError('duplicate', name);
  const changes = [groupRewrite(ctx, groupId, patch), ...(patch.tableIds ? releaseFromOtherGroups(ctx, patch.tableIds, groupId) : [])];
  if (name && name !== g?.name) changes.push(...viewsRewrite(ctx, { groups: { [groupId]: name } }), ...metadataRewrite(ctx, { groups: { [groupId]: name } }));
  return { source: apply(ctx.source, changes) };
}

export function deleteGroup(ctx: EditCtx, groupId: string): EditResult {
  const loc = ctx.info.groups[groupId];
  if (!loc) throw new Error(`unknown group ${groupId}`);
  return { source: apply(ctx.source, [removal(ctx.source, loc), ...viewsRewrite(ctx, { groups: { [groupId]: null } }), ...metadataRewrite(ctx, { groups: { [groupId]: null } })]) };
}

// ---- diagram views ------------------------------------------------------------------------

type ViewSpec = Pick<DView, 'name' | 'tables' | 'groups' | 'schemas' | 'notes'>;

/** Renames/removals of tables, groups and notes that views must follow (ids → new name, or null when removed). */
interface ViewRefs {
  tables?: Record<string, { schema?: string; name: string } | null>;
  groups?: Record<string, string | null>;
  notes?: Record<string, string | null>;
}

function viewBlock(ctx: EditCtx, v: ViewSpec, refs: ViewRefs = {}) {
  const sub = (kw: string, items: string[]) => `  ${kw} {\n${items.map((i) => `    ${i}`).join('\n')}\n  }`;
  const parts: string[] = [];
  if (v.tables === 'all') parts.push(sub('Tables', ['*']));
  else if (v.tables?.length) parts.push(sub('Tables', v.tables.map((id) => tableRefText(refs.tables?.[id] ?? table(ctx, id)))));
  if (v.groups?.length) parts.push(sub('TableGroups', v.groups.map((id) => ident(refs.groups?.[id] ?? ctx.model.groups.find((g) => g.id === id)?.name ?? id.replace(/^group:/, '')))));
  if (v.schemas?.length) parts.push(sub('Schemas', v.schemas.map(ident)));
  if (v.notes === 'all') parts.push(sub('Notes', ['*']));
  else if (v.notes?.length) parts.push(sub('Notes', v.notes.map((id) => ident(refs.notes?.[id] ?? id.replace(/^note:/, '')))));
  return `DiagramView ${ident(v.name)} {\n${parts.join('\n')}${parts.length ? '\n' : ''}}`;
}

/** Rewrites the views that mention renamed or removed tables / groups / notes. */
function viewsRewrite(ctx: EditCtx, refs: ViewRefs): Change[] {
  const keep = <T extends string>(list: T[] | null, map: Record<string, unknown> | undefined) => {
    if (!list || !map) return list;
    const out = list.filter((id) => map[id] !== null);
    return out.length ? out : null;
  };
  const touches = (list: ViewSelection | string[] | null, map?: Record<string, unknown>) => Array.isArray(list) && !!map && list.some((id) => id in map);
  const out: Change[] = [];
  for (const v of ctx.model.views) {
    const loc = ctx.info.views[v.id];
    if (!loc || !(touches(v.tables, refs.tables) || touches(v.groups, refs.groups) || touches(v.notes, refs.notes))) continue;
    const next: ViewSpec = {
      name: v.name,
      tables: v.tables === 'all' ? 'all' : keep(v.tables, refs.tables),
      groups: keep(v.groups, refs.groups),
      schemas: v.schemas,
      notes: v.notes === 'all' ? 'all' : keep(v.notes, refs.notes),
    };
    out.push({ ...loc, text: viewBlock(ctx, next, refs) });
  }
  return out;
}

/** A new view: of the given tables, or of everything. */
export function addView(ctx: EditCtx, tableIds: string[] = []): EditResult {
  const name = uniqueName('view', new Set(ctx.model.views.map((v) => v.name)));
  const spec: ViewSpec = tableIds.length
    ? { name, tables: tableIds, groups: null, schemas: null, notes: null }
    : { name, tables: 'all', groups: null, schemas: null, notes: 'all' };
  return { source: appendBlock(ctx.source, viewBlock(ctx, spec)), created: `view:${name}` };
}

export function updateView(ctx: EditCtx, viewId: string, patch: Partial<ViewSpec>): EditResult {
  const v = ctx.model.views.find((x) => x.id === viewId);
  const loc = ctx.info.views[viewId];
  if (!v || !loc) throw new Error(`unknown view ${viewId}`);
  const name = patch.name?.trim() || v.name;
  if (name !== v.name && ctx.model.views.some((x) => x.name === name)) throw new EditError('duplicate', name);
  const empty = <T,>(x: T[] | null | undefined) => (Array.isArray(x) && !x.length ? null : x);
  const spec: ViewSpec = {
    name,
    tables: patch.tables !== undefined ? (patch.tables === 'all' ? 'all' : empty(patch.tables) ?? null) : v.tables,
    groups: patch.groups !== undefined ? empty(patch.groups) ?? null : v.groups,
    schemas: patch.schemas !== undefined ? empty(patch.schemas) ?? null : v.schemas,
    notes: patch.notes !== undefined ? (patch.notes === 'all' ? 'all' : empty(patch.notes) ?? null) : v.notes,
  };
  const source = apply(ctx.source, [{ ...loc, text: viewBlock(ctx, spec) }]);
  return name !== v.name ? { source, renamed: { [viewId]: `view:${name}` } } : { source };
}

export function deleteView(ctx: EditCtx, viewId: string): EditResult {
  const loc = ctx.info.views[viewId];
  if (!loc) throw new Error(`unknown view ${viewId}`);
  return { source: apply(ctx.source, [removal(ctx.source, loc)]) };
}

// ---- dependencies (Dep) --------------------------------------------------------------------

function depEndText(ctx: EditCtx, e: DDepEnd, names: Names = {}) {
  const t = table(ctx, e.tableId);
  const tn = tableRefText(names.table?.[t.id] ?? t);
  if (!e.fieldIds.length) return tn;
  const cols = e.fieldIds.map((f) => ident(names.field?.[f] ?? fieldName(f, t.id)));
  return `${tn}.${cols.length === 1 ? cols[0] : `(${cols.join(', ')})`}`;
}

interface DepSpec {
  name?: string;
  color?: string;
  note?: string;
  edges: DDep['edges'];
  metadata?: Record<string, string>;
}

function depBlock(ctx: EditCtx, d: DepSpec, names?: Names) {
  const settings = [d.color && `color: ${d.color}`, d.note && `note: ${str(d.note)}`].filter(Boolean) as string[];
  const lines = [
    ...d.edges.map((e) => `  ${depEndText(ctx, e.up, names)} -> ${depEndText(ctx, e.down, names)}`),
    // custom entries are literals (strings quoted; numbers, booleans and null as they are)
    ...Object.entries(d.metadata ?? {}).filter(([k]) => k.trim()).map(([k, v]) => `  ${k.trim()}: ${v.trim() || 'null'}`),
  ];
  return `Dep${d.name ? ` ${ident(d.name)}` : ''}${bracket(settings)} {\n${lines.join('\n')}\n}`;
}

const depSpecOf = (ctx: EditCtx, d: DDep): DepSpec => ({ name: d.name, color: d.color, note: d.note, edges: d.edges, metadata: ctx.info.deps[d.id]?.metadata });

/** Inline dep text, seen from its owner (the column or table carrying `[dep: …]`). */
function inlineDepText(ctx: EditCtx, d: DDep, names?: Names) {
  const di = ctx.info.deps[d.id];
  const e = d.edges[0];
  const ownerIsDown = di.owner!.kind === 'table' ? e.down.tableId === di.owner!.id && !e.down.fieldIds.length : e.down.fieldIds.includes(di.owner!.id);
  return ownerIsDown ? `dep: <- ${depEndText(ctx, e.up, names)}` : `dep: -> ${depEndText(ctx, e.down, names)}`;
}

/** Removes inline `dep:` settings (all on the same owner) from the column or table header carrying them. */
function withoutInlineDeps(ctx: EditCtx, depIds: string[]): Change {
  const owner = ctx.info.deps[depIds[0]].owner!;
  const texts = depIds.map((id) => { const l = ctx.info.deps[id].loc; return ctx.source.slice(l.start, l.end).trim(); });
  if (owner.kind === 'field') return withoutSettings(ctx, owner.id, texts);
  const h = parseHeader(ctx, owner.id);
  return { ...h.loc, text: `${h.keyword} ${h.name}${h.alias ? ` ${h.alias}` : ''}${bracket(h.settings.filter((x) => !texts.includes(x.trim())))} ` };
}
const withoutInlineDep = (ctx: EditCtx, depId: string) => withoutInlineDeps(ctx, [depId]);

/**
 * Rewrites deps after renames (`names`) or removed tables/columns. Edges touching something
 * removed are dropped; a dep left without edges is removed. `skipOwner` is a column or table whose
 * own text is being rewritten anyway; `ignore` matches locations inside removed text.
 */
function depsRewrite(ctx: EditCtx, names: Names, removed: { tables?: string[]; fields?: string[] }, skipOwner?: string, ignore: (l: Loc) => boolean = () => false): Change[] {
  const touched = (e: DDepEnd) => !!names.table?.[e.tableId] || e.fieldIds.some((f) => names.field?.[f]);
  const gone = (e: DDepEnd) => !!removed.tables?.includes(e.tableId) || e.fieldIds.some((f) => removed.fields?.includes(f));
  const out: Change[] = [];
  // several inline deps dropped from one column/header must become a single change
  const drops = new Map<string, string[]>();
  for (const d of ctx.model.deps) {
    const di = ctx.info.deps[d.id];
    if (!di || ignore(di.loc) || (skipOwner !== undefined && di.owner?.id === skipOwner)) continue;
    const edges = d.edges.filter((e) => !gone(e.up) && !gone(e.down));
    if (edges.length === d.edges.length && !d.edges.some((e) => touched(e.up) || touched(e.down))) continue;
    if (!edges.length && di.inline) drops.set(`${di.owner!.kind}:${di.owner!.id}`, [...(drops.get(`${di.owner!.kind}:${di.owner!.id}`) ?? []), d.id]);
    else if (!edges.length) out.push(removal(ctx.source, di.loc));
    else if (di.inline) out.push({ ...di.loc, text: inlineDepText(ctx, { ...d, edges }, names) });
    else out.push({ ...di.loc, text: depBlock(ctx, { ...depSpecOf(ctx, d), edges }, names) });
  }
  for (const ids of drops.values()) {
    if (!ignore(ctx.info.fields[ctx.info.deps[ids[0]].owner!.id] ?? { start: -1, end: -1 })) out.push(withoutInlineDeps(ctx, ids));
  }
  return out;
}

const endKey = (e: DDepEnd) => `${e.tableId}|${e.fieldIds.join(',')}`;

/**
 * DBML rules for deps: all edges of one Dep go to the same downstream table and are all
 * table-level or all column-level, and no two deps may connect the same endpoints.
 */
function checkDepEdges(ctx: EditCtx, edges: DDep['edges'], self?: string) {
  if (!edges.length) throw new EditError('columnCount');
  const down = new Set(edges.map((e) => e.down.tableId));
  const levels = new Set(edges.flatMap((e) => [!!e.up.fieldIds.length, !!e.down.fieldIds.length]));
  if (down.size > 1 || levels.size > 1) throw new EditError('depEdges');
  for (const e of edges) {
    if (!!e.up.fieldIds.length && e.up.fieldIds.length !== e.down.fieldIds.length) throw new EditError('columnCount');
    const k = `${endKey(e.up)}>${endKey(e.down)}`;
    const other = ctx.model.deps.find((d) => d.id !== self && d.edges.some((x) => `${endKey(x.up)}>${endKey(x.down)}` === k));
    if (other) throw new EditError('duplicate', `${depEndText(ctx, e.up)} -> ${depEndText(ctx, e.down)}`);
  }
}

/** Adds a dependency: `up` feeds `down` (both tables, or both columns of them). */
export function addDep(ctx: EditCtx, up: DDepEnd, down: DDepEnd): EditResult {
  table(ctx, up.tableId);
  table(ctx, down.tableId);
  checkDepEdges(ctx, [{ up, down }]);
  return { source: appendBlock(ctx.source, depBlock(ctx, { edges: [{ up, down }] })) };
}

/** Changes a dep; an inline `[dep: …]` becomes a `Dep` block (only blocks carry names, settings and several edges). */
export function updateDep(ctx: EditCtx, depId: string, patch: Partial<DepSpec>): EditResult {
  const d = ctx.model.deps.find((x) => x.id === depId);
  const di = ctx.info.deps[depId];
  if (!d || !di) throw new Error(`unknown dep ${depId}`);
  const cur = depSpecOf(ctx, d);
  const spec: DepSpec = {
    name: patch.name !== undefined ? patch.name.trim() || undefined : cur.name,
    color: patch.color !== undefined ? patch.color || undefined : cur.color,
    note: patch.note !== undefined ? patch.note || undefined : cur.note,
    edges: patch.edges ?? cur.edges,
    metadata: patch.metadata ?? cur.metadata,
  };
  if (patch.edges) checkDepEdges(ctx, spec.edges, depId);
  if (!di.inline) return { source: apply(ctx.source, [{ ...di.loc, text: depBlock(ctx, spec) }]) };
  const removed = apply(ctx.source, [withoutInlineDep(ctx, depId)]);
  return { source: appendBlock(removed, depBlock(ctx, spec)) };
}

export function deleteDep(ctx: EditCtx, depId: string): EditResult {
  const di = ctx.info.deps[depId];
  if (!di) throw new Error(`unknown dep ${depId}`);
  return { source: apply(ctx.source, [di.inline ? withoutInlineDep(ctx, depId) : removal(ctx.source, di.loc)]) };
}

// ---- custom properties (Metadata blocks) ---------------------------------------------------

export type MetadataKind = 'Table' | 'Column' | 'TableGroup' | 'Note';

/** The DBML target of a Metadata block for an element id. */
function metadataTarget(ctx: EditCtx, kind: MetadataKind, id: string, names: MetaNames = {}): string | null {
  if (kind === 'Table') return names.tables?.[id] === null ? null : tableRefText(names.tables?.[id] ?? table(ctx, id));
  if (kind === 'Column') {
    if (names.columns?.[id] === null) return null;
    const t = ctx.model.tables.find((x) => x.fields.some((f) => f.id === id));
    if (!t || names.tables?.[t.id] === null) return null;
    return `${tableRefText(names.tables?.[t.id] ?? t)}.${ident(names.columns?.[id] ?? fieldName(id, t.id))}`;
  }
  if (kind === 'TableGroup') return names.groups?.[id] === null ? null : ident(names.groups?.[id] ?? ctx.model.groups.find((g) => g.id === id)?.name ?? id.slice(6));
  return names.notes?.[id] === null ? null : ident(names.notes?.[id] ?? id.slice(5));
}

/** Renamed (new name) or removed (null) elements that Metadata blocks must follow. */
interface MetaNames {
  tables?: Record<string, { schema?: string; name: string } | null>;
  columns?: Record<string, string | null>;
  groups?: Record<string, string | null>;
  notes?: Record<string, string | null>;
}

function metadataRewrite(ctx: EditCtx, names: MetaNames): Change[] {
  const out: Change[] = [];
  for (const [key, m] of Object.entries(ctx.info.metadata)) {
    const kind = key.slice(0, key.indexOf(':')) as MetadataKind;
    const id = key.slice(key.indexOf(':') + 1);
    const tableOfCol = kind === 'Column' ? ctx.model.tables.find((x) => x.fields.some((f) => f.id === id))?.id : undefined;
    const hit = (kind === 'Table' && names.tables && id in names.tables)
      || (kind === 'Column' && ((names.columns && id in names.columns) || (names.tables && tableOfCol && tableOfCol in names.tables)))
      || (kind === 'TableGroup' && names.groups && id in names.groups)
      || (kind === 'Note' && names.notes && id in names.notes);
    if (!hit) continue;
    const target = metadataTarget(ctx, kind, id, names);
    if (target === null) { out.push(removal(ctx.source, m.loc)); continue; }
    const open = findTop(ctx.source, '{', m.loc.start, m.loc.end);
    out.push({ start: m.loc.start, end: open, text: `Metadata ${kind} ${target} ` });
  }
  return out;
}

/**
 * Sets the custom properties of a table, column, table group or sticky note (`Metadata <Kind>
 * <target> { key: 'value' }`). Built-in entries of an existing block (note, colours) are kept;
 * a block left empty is removed.
 */
export function setMetadata(ctx: EditCtx, kind: MetadataKind, id: string, custom: Record<string, string>): EditResult {
  const target = metadataTarget(ctx, kind, id);
  if (!target) throw new Error(`unknown ${kind} ${id}`);
  const value = (v: string) => (/^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : str(v));
  const entries = Object.entries(custom).filter(([k]) => /^[A-Za-z_]\w*$/.test(k.trim())).map(([k, v]) => `  ${k.trim()}: ${value(v)}`);
  const m = ctx.info.metadata[`${kind}:${id}`];
  const lines = [...(m?.builtins.map((b) => `  ${b}`) ?? []), ...entries];
  if (!m) return entries.length ? { source: appendBlock(ctx.source, `Metadata ${kind} ${target} {\n${lines.join('\n')}\n}`) } : { source: ctx.source };
  if (!lines.length) return { source: apply(ctx.source, [removal(ctx.source, m.loc)]) };
  return { source: apply(ctx.source, [{ ...m.loc, text: `Metadata ${kind} ${target} {\n${lines.join('\n')}\n}` }]) };
}
