import type { DEnum, DField, DGroup, DiagramModel, DNote, DRef, DTable, Diagnostic } from './types';

// Loose shape of @dbml/core's `Database.normalize()` output — only the parts we read.
type Id = number;
interface NormalizedModel {
  database?: Record<Id, { name?: string; note?: string; databaseType?: string }>;
  schemas?: Record<Id, { name: string }>;
  tables?: Record<Id, { id: Id; name: string; alias?: string | null; note?: string | null; headerColor?: string | null; schemaId: Id; groupId?: Id | null; fieldIds: Id[] }>;
  fields?: Record<Id, {
    id: Id; name: string; tableId: Id; pk?: boolean; unique?: boolean; not_null?: boolean; increment?: boolean;
    note?: string | null; enumId?: Id | null; endpointIds?: Id[];
    type?: { schemaName?: string | null; type_name?: string; args?: string | null };
    dbdefault?: { type?: string; value?: unknown } | null;
  }>;
  refs?: Record<Id, { id: Id; name?: string | null; endpointIds: Id[] }>;
  endpoints?: Record<Id, { id: Id; relation: string; fieldIds: Id[]; tableName: string; schemaName?: string | null }>;
  tableGroups?: Record<Id, { id: Id; name: string; color?: string | null; note?: string | null; tableIds: Id[]; schemaId: Id }>;
  enums?: Record<Id, { id: Id; name: string; schemaId: Id; valueIds: Id[] }>;
  enumValues?: Record<Id, { id: Id; name: string; note?: string | null }>;
  notes?: Record<Id, { id: Id; name: string; content: string; headerColor?: string | null; color?: string | null }>;
  indexes?: Record<Id, { id: Id; pk?: boolean; tableId: Id; columnIds: Id[] }>;
  indexColumns?: Record<Id, { id: Id; type: string; value: string }>;
}

const DEFAULT_SCHEMA = 'public';
const vals = <T,>(o: Record<Id, T> | undefined): T[] => (o ? Object.values(o) : []);
const opt = (s: string | null | undefined) => (s == null || s === '' ? undefined : s);

function qualified(schema: string | undefined, name: string) {
  return !schema || schema === DEFAULT_SCHEMA ? name : `${schema}.${name}`;
}

function formatDefault(d: { type?: string; value?: unknown } | null | undefined): string | undefined {
  if (!d || d.value === undefined || d.value === null) return undefined;
  if (d.type === 'string') return `'${String(d.value)}'`;
  if (d.type === 'expression') return `\`${String(d.value)}\``;
  return String(d.value);
}

export function toDiagramModel(n: NormalizedModel): DiagramModel {
  const schemaName = (id: Id) => n.schemas?.[id]?.name;

  const tableIdOf = new Map<Id, string>();
  for (const t of vals(n.tables)) tableIdOf.set(t.id, qualified(schemaName(t.schemaId), t.name));

  const enumIdOf = new Map<Id, string>();
  for (const e of vals(n.enums)) enumIdOf.set(e.id, qualified(schemaName(e.schemaId), e.name));

  const groupIdOf = new Map<Id, string>();
  for (const g of vals(n.tableGroups)) groupIdOf.set(g.id, `group:${qualified(schemaName(g.schemaId), g.name)}`);

  const fieldIdOf = (fid: Id) => {
    const f = n.fields?.[fid];
    return f ? `${tableIdOf.get(f.tableId)}.${f.name}` : '';
  };

  // Composite primary keys (several `[pk]` columns or `(a, b) [pk]` in Indexes) are stored as
  // pk indexes, with the columns' own `pk` flag left false.
  const compositePk = new Set<string>();
  for (const idx of vals(n.indexes)) {
    if (!idx.pk) continue;
    for (const cid of idx.columnIds) {
      const col = n.indexColumns?.[cid];
      if (col?.type === 'column') compositePk.add(`${idx.tableId}:${col.value}`);
    }
  }

  const tables: DTable[] = vals(n.tables).map((t) => {
    const id = tableIdOf.get(t.id)!;
    const schema = schemaName(t.schemaId);
    const fields: DField[] = t.fieldIds.map((fid) => {
      const f = n.fields![fid];
      const type = f.type?.type_name ?? '';
      return {
        id: `${id}.${f.name}`,
        name: f.name,
        // type_name already carries args, e.g. varchar(255)
        type: f.type?.schemaName ? `${f.type.schemaName}.${type}` : type,
        pk: !!f.pk || compositePk.has(`${t.id}:${f.name}`),
        notNull: !!f.not_null,
        unique: !!f.unique,
        increment: !!f.increment,
        note: opt(f.note),
        defaultValue: formatDefault(f.dbdefault),
        enumId: f.enumId != null ? enumIdOf.get(f.enumId) : undefined,
        isRef: (f.endpointIds?.length ?? 0) > 0,
      };
    });
    return {
      id,
      name: t.name,
      schema: schema && schema !== DEFAULT_SCHEMA ? schema : undefined,
      alias: opt(t.alias),
      note: opt(t.note),
      headerColor: opt(t.headerColor),
      groupId: t.groupId != null ? groupIdOf.get(t.groupId) : undefined,
      fields,
    };
  });

  const refs: DRef[] = [];
  for (const r of vals(n.refs)) {
    const eps = r.endpointIds.map((eid) => n.endpoints?.[eid]).filter((e) => !!e);
    if (eps.length !== 2) continue;
    const [a, b] = eps.map((e) => {
      const fieldIds = e!.fieldIds.map(fieldIdOf).filter(Boolean);
      const f0 = n.fields?.[e!.fieldIds[0]];
      const tableId = f0 ? tableIdOf.get(f0.tableId)! : qualified(e!.schemaName ?? undefined, e!.tableName);
      return { tableId, fieldIds, relation: e!.relation };
    });
    if (!a.fieldIds.length || !b.fieldIds.length) continue;
    refs.push({ id: `ref:${r.id}`, name: opt(r.name), from: a, to: b });
  }

  const groups: DGroup[] = vals(n.tableGroups).map((g) => ({
    id: groupIdOf.get(g.id)!,
    name: g.name,
    color: opt(g.color),
    note: opt(g.note),
    tableIds: g.tableIds.map((tid) => tableIdOf.get(tid)!).filter(Boolean),
  }));

  const enums: DEnum[] = vals(n.enums).map((e) => ({
    id: enumIdOf.get(e.id)!,
    name: e.name,
    values: e.valueIds.map((vid) => n.enumValues![vid]).filter(Boolean).map((v) => ({ name: v.name, note: opt(v.note) })),
  }));

  const notes: DNote[] = vals(n.notes).map((note) => ({
    id: `note:${note.name}`,
    name: note.name,
    content: note.content,
    color: opt(note.headerColor ?? note.color),
  }));

  const db = vals(n.database)[0];
  const project = db && (db.name || db.databaseType || db.note)
    ? { name: opt(db.name), databaseType: opt(db.databaseType), note: opt(db.note) }
    : undefined;

  return { project, tables, refs, groups, enums, notes };
}

interface RawDiag {
  message?: string;
  type?: string;
  location?: { start?: { line: number; column: number }; end?: { line: number; column: number } };
}

/** Converts whatever @dbml/core threw (CompilerError with `diags`, or a plain Error) into diagnostics. */
export function toDiagnostics(err: unknown): Diagnostic[] {
  const diags: RawDiag[] | undefined = (err as { diags?: RawDiag[] })?.diags;
  if (Array.isArray(diags) && diags.length) {
    const seen = new Set<string>();
    return diags.filter((d) => {
      // the compiler can report the same problem more than once
      const key = `${d.location?.start?.line}:${d.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((d) => ({
      message: d.message ?? 'Syntax error',
      line: d.location?.start?.line ?? 1,
      column: d.location?.start?.column ?? 1,
      endLine: d.location?.end?.line,
      endColumn: d.location?.end?.column,
      severity: d.type === 'warning' || d.type === 'info' ? d.type : 'error',
    }));
  }
  const message = err instanceof Error ? err.message : String(err);
  return [{ message, line: 1, column: 1, severity: 'error' }];
}
