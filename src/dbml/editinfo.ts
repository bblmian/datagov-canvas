import { formatDefault, qualified } from './model';
import { BUILTIN_COLUMN_SETTINGS, bodyStatements, findTop, literalDisplay, parseField, skip, splitSetting, str } from './text';
import type { BlockInfo, DCheck, DField, DIndex, DRecords, EditInfo, Loc } from './types';

// Loose shape of @dbml/core's (not normalized) Database — only what we read. Every element carries
// a `token` with source offsets, and the same numeric `id` that `normalize()` uses.
type Token = { start: { offset: number }; end: { offset: number } };
interface El { id: number; token?: Token; name: string }
interface Field extends El {
  type?: { schemaName?: string | null; type_name?: string };
  pk?: boolean; not_null?: boolean; unique?: boolean; increment?: boolean; note?: string | null;
  dbdefault?: { type?: string; value?: unknown } | null;
  checks?: { expression: string }[];
  injectedPartial?: { name: string } | null;
}
interface Index { token?: Token; columns: { type: string; value: string }[]; unique?: boolean; pk?: boolean; name?: string | null; type?: string | null; note?: string | null }
interface Check { token?: Token; expression: string; name?: string | null }
interface Block extends El { noteToken?: Token | null; note?: string | null; headerColor?: string | null; fields: Field[]; indexes: Index[]; checks?: Check[]; partials?: { name: string; token?: Token }[] }
interface Ref extends El { onDelete?: string | null; onUpdate?: string | null; color?: string | null }
interface Dep extends El { metadata?: Record<string, unknown> | null }
interface Schema { name: string; tables: Block[]; refs: Ref[]; enums: El[]; tableGroups: El[]; deps?: Dep[] }
interface Records { token?: Token; tableName: string; schemaName?: string | null; columns: string[]; values: { value: unknown; type: string; token?: Token }[][]; example?: boolean }
interface Database { token?: Token; name?: string; schemas: Schema[]; notes?: El[]; tablePartials?: Block[]; records?: Records[]; diagramViews?: { name: string; token?: Token }[] }

const loc = (t: Token | null | undefined): Loc | undefined => (t ? { start: t.start.offset, end: t.end.offset } : undefined);
const opt = (s: string | null | undefined) => (s == null || s === '' ? undefined : s);
const within = (outer: Loc) => (l: Loc) => outer.start <= l.start && l.end <= outer.end;

/** A records cell as the user sees and types it: strings unquoted, everything else as written. */
function cellText(v: { value: unknown; type: string }) {
  if (v.value === null || v.value === undefined) return 'null';
  if (v.type === 'expression') return `\`${String(v.value)}\``;
  return String(v.value);
}

/**
 * Index columns in written order. @dbml/core lists expressions before plain columns, so they are
 * read from the source: `col`, or `(a, \`expr\`, …)` before the settings.
 */
function indexColumns(source: string, l: Loc, parsed: { type: string; value: string }[]): string[] {
  const text = source.slice(l.start, l.end).trim();
  if (!text.startsWith('(')) return parsed.map((c) => (c.type === 'expression' ? `\`${c.value}\`` : c.value));
  const cols: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '`') {
      const e = text.indexOf('`', i + 1);
      cur += text.slice(i, e + 1);
      i = e;
    } else if (ch === '(') { depth++; cur += ch; }
    else if (ch === ')' && depth > 0) { depth--; cur += ch; }
    else if (ch === ')' || (ch === ',' && depth === 0)) {
      cols.push(cur.trim().replace(/^"(.*)"$/, '$1'));
      cur = '';
      if (ch === ')') break;
    } else cur += ch;
  }
  return cols.filter(Boolean);
}

function blockInfo(b: Block, l: Loc, source: string): BlockInfo {
  const indexes: DIndex[] = [];
  for (const ix of b.indexes ?? []) {
    const il = loc(ix.token);
    if (!il) continue;
    indexes.push({
      columns: indexColumns(source, il, ix.columns),
      unique: !!ix.unique,
      pk: !!ix.pk,
      name: opt(ix.name),
      type: opt(ix.type),
      note: opt(ix.note),
      loc: il,
    });
  }
  const checks: DCheck[] = [];
  for (const c of b.checks ?? []) {
    const cl = loc(c.token);
    if (cl) checks.push({ expression: c.expression, name: opt(c.name), loc: cl });
  }
  const partials = (b.partials ?? []).map((p) => ({ name: p.name, loc: loc(p.token)! })).filter((p) => p.loc);
  return { loc: l, noteLoc: loc(b.noteToken), indexes, checks, partials, records: [] };
}

function toField(f: Field, id: string): DField {
  const type = f.type?.type_name ?? '';
  return {
    id,
    name: f.name,
    type: f.type?.schemaName ? `${f.type.schemaName}.${type}` : type,
    pk: !!f.pk,
    notNull: !!f.not_null,
    unique: !!f.unique,
    increment: !!f.increment,
    note: opt(f.note),
    defaultValue: formatDefault(f.dbdefault),
    isRef: false,
  };
}

/** `key: value` → key and the value as the user sees it (strings unquoted). */
function keyValue(text: string): { key: string; value: string } | undefined {
  const m = /^\s*([A-Za-z_][\w ]*?)\s*:\s*([\s\S]*?)\s*$/.exec(text);
  if (!m) return undefined;
  let v = m[2];
  if (v.startsWith("'''")) v = v.slice(3, -3);
  else if (/^'.*'$/s.test(v) || /^".*"$/s.test(v)) v = v.slice(1, -1).replace(/\\(['"\\])/g, '$1');
  return { key: m[1], value: v };
}

const splitName = (s: string) => (s.match(/"(?:[^"\\]|\\.)*"|[^.]+/g) ?? []).map((p) => p.trim().replace(/^"(.*)"$/, '$1'));

/** `Metadata <Kind> <target> { key: value … }` blocks (not part of @dbml/core's model). */
function scanMetadata(source: string) {
  const out: { key: string; loc: Loc; custom: Record<string, string>; builtins: string[] }[] = [];
  let depth = 0;
  for (let i = 0; i < source.length;) {
    const c = source[i];
    if (c === '{' || c === '}') { depth += c === '{' ? 1 : -1; i++; continue; }
    const m = depth === 0 && (i === 0 || /\s/.test(source[i - 1])) ? /^Metadata\s+(Table|Column|TableGroup|Note)\s+/i.exec(source.slice(i, i + 40)) : null;
    if (!m) { i = skip(source, i); continue; }
    const open = findTop(source, '{', i);
    const close = open < 0 ? -1 : findTop(source, '}', open + 1);
    if (close < 0) break;
    const kind = m[1].toLowerCase();
    const parts = splitName(source.slice(i + m[0].length, open).trim());
    let key = '';
    if (kind === 'table') key = `Table:${qualified(parts.length > 1 ? parts[0] : undefined, parts.at(-1)!)}`;
    else if (kind === 'column') key = `Column:${qualified(parts.length > 2 ? parts[0] : undefined, parts.at(-2)!)}.${parts.at(-1)}`;
    else if (kind === 'tablegroup') key = `TableGroup:group:${qualified(parts.length > 1 ? parts[0] : undefined, parts.at(-1)!)}`;
    else key = `Note:note:${parts.at(-1)}`;
    const custom: Record<string, string> = {};
    const builtins: string[] = [];
    for (const st of bodyStatements(source.slice(open + 1, close))) {
      const kv = keyValue(st.text);
      if (!kv) continue;
      if (['note', 'headercolor', 'color'].includes(kv.key.toLowerCase())) builtins.push(st.text.trim());
      else custom[kv.key] = kv.value;
    }
    out.push({ key, loc: { start: i, end: close + 1 }, custom, builtins });
    i = close + 1;
  }
  return out;
}

/** Builds the source map used by the graphical editor; ids match those of `toDiagramModel`. */
export function toEditInfo(db: Database, source: string): EditInfo {
  const info: EditInfo = { tables: {}, partials: {}, fields: {}, injected: {}, fieldChecks: {}, fieldCustom: {}, fieldRef: {}, refs: {}, enums: {}, groups: {}, notes: {}, views: {}, deps: {}, metadata: {}, projectCustom: {} };
  const fieldLocs: { id: string; loc: Loc }[] = [];
  const addField = (f: Field, id: string) => {
    const l = loc(f.token);
    if (!l) return;
    info.fields[id] = l;
    fieldLocs.push({ id, loc: l });
    if (f.checks?.length) info.fieldChecks[id] = f.checks.map((c) => c.expression);
    const custom: Record<string, string> = {};
    for (const st of parseField(source.slice(l.start, l.end)).settings) {
      const { key, value } = splitSetting(st);
      if (key === 'ref' && !info.fieldRef[id]) info.fieldRef[id] = value;
      else if (value && !BUILTIN_COLUMN_SETTINGS.includes(key)) custom[st.slice(0, st.indexOf(':')).trim()] = value;
    }
    if (Object.keys(custom).length) info.fieldCustom[id] = custom;
  };

  for (const p of db.tablePartials ?? []) {
    const l = loc(p.token);
    if (!l) continue;
    const fields = p.fields.map((f) => toField(f, `partial:${p.name}.${f.name}`));
    info.partials[p.name] = { ...blockInfo(p, l, source), name: p.name, note: opt(p.note), headerColor: opt(p.headerColor), fields };
    for (const f of p.fields) addField(f, `partial:${p.name}.${f.name}`);
  }

  for (const s of db.schemas) {
    for (const t of s.tables) {
      const tid = qualified(s.name, t.name);
      const tloc = loc(t.token);
      if (!tloc) continue;
      info.tables[tid] = blockInfo(t, tloc, source);
      for (const f of t.fields) {
        const fid = `${tid}.${f.name}`;
        // a column injected from a partial has the partial's token: it is edited there
        if (f.injectedPartial) info.injected[fid] = f.injectedPartial.name;
        else addField(f, fid);
      }
    }
    for (const e of s.enums) { const l = loc(e.token); if (l) info.enums[qualified(s.name, e.name)] = l; }
    for (const g of s.tableGroups) { const l = loc(g.token); if (l) info.groups[`group:${qualified(s.name, g.name)}`] = l; }
  }
  for (const s of db.schemas) {
    for (const r of s.refs) {
      const l = loc(r.token);
      if (!l) continue;
      // an inline ref's token is its `ref: …` setting, which lies inside the field's token
      const owner = fieldLocs.find((f) => within(f.loc)(l));
      info.refs[`ref:${r.id}`] = { loc: l, inline: !!owner, ownerFieldId: owner?.id, onDelete: opt(r.onDelete), onUpdate: opt(r.onUpdate), color: opt(r.color) };
    }
  }
  for (const r of db.records ?? []) {
    const l = loc(r.token);
    const tid = qualified(r.schemaName ?? undefined, r.tableName);
    const t = info.tables[tid];
    if (!l || !t) continue;
    const raw = r.values.map((row) => row.map((v) => { const vl = loc(v.token); return vl ? source.slice(vl.start, vl.end) : cellText(v); }));
    const rec: DRecords = { loc: l, inline: within(t.loc)(l), example: !!r.example, columns: r.columns, raw, rows: raw.map((row) => row.map(literalDisplay)) };
    t.records.push(rec);
  }
  for (const s of db.schemas) {
    for (const d of s.deps ?? []) {
      const l = loc(d.token);
      if (!l) continue;
      // an inline dep's token is its `dep: …` setting, on a column or in a table's header settings
      const field = fieldLocs.find((f) => within(f.loc)(l));
      const tableId = !field ? Object.keys(info.tables).find((id) => within(info.tables[id].loc)(l)) : undefined;
      const owner = field ? { kind: 'field' as const, id: field.id } : tableId ? { kind: 'table' as const, id: tableId } : undefined;
      // custom entries as written: @dbml/core reports `true` and `'true'` (and `null`) alike, so the
      // literals are read from the Dep block's own text
      const metadata: Record<string, string> = {};
      if (!owner) {
        const open = findTop(source, '{', l.start, l.end);
        for (const st of open < 0 ? [] : bodyStatements(source.slice(open + 1, l.end - 1))) {
          const m = /^\s*([A-Za-z_]\w*)\s*:\s*([\s\S]*?)\s*$/.exec(st.text);
          if (m && !/(->|<-)/.test(st.text)) metadata[m[1]] = m[2];
        }
      } else {
        for (const [k, v] of Object.entries(d.metadata ?? {})) metadata[k] = typeof v === 'string' ? str(v) : String(v);
      }
      info.deps[`dep:${d.id}`] = { loc: l, inline: !!owner, owner, metadata };
    }
  }
  for (const m of scanMetadata(source)) info.metadata[m.key] ??= { loc: m.loc, custom: m.custom, builtins: m.builtins };
  for (const n of db.notes ?? []) { const l = loc(n.token); if (l) info.notes[`note:${n.name}`] = l; }
  for (const v of db.diagramViews ?? []) { const l = loc(v.token); if (l) info.views[`view:${v.name}`] = l; }
  const pl = loc(db.token);
  if (pl && db.name !== undefined) {
    info.project = pl;
    const open = findTop(source, '{', pl.start, pl.end);
    for (const st of bodyStatements(source.slice(open + 1, pl.end - 1))) {
      const kv = keyValue(st.text);
      if (kv && !['database_type', 'note'].includes(kv.key.toLowerCase())) info.projectCustom[kv.key] = kv.value;
    }
  }
  return info;
}
