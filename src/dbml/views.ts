import type { DiagramModel, DTable, DView } from './types';

/** Is a table shown by a view (listed itself, through its group, or through its schema)? */
export function viewShowsTable(v: DView, t: DTable) {
  return v.tables === 'all'
    || (Array.isArray(v.tables) && v.tables.includes(t.id))
    || (!!t.groupId && !!v.groups?.includes(t.groupId))
    || !!v.schemas?.includes(t.schema ?? 'public');
}

/** The part of the model a view shows: its tables and notes, refs between shown tables, and groups of shown tables. */
export function applyView(model: DiagramModel, v: DView | undefined): DiagramModel {
  if (!v) return model;
  const tables = model.tables.filter((t) => viewShowsTable(v, t));
  const ids = new Set(tables.map((t) => t.id));
  return {
    ...model,
    tables,
    refs: model.refs.filter((r) => ids.has(r.from.tableId) && ids.has(r.to.tableId)),
    groups: model.groups
      .map((g) => (g.tableIds.every((id) => ids.has(id)) ? g : { ...g, tableIds: g.tableIds.filter((id) => ids.has(id)) }))
      .filter((g) => g.tableIds.length),
    notes: v.notes === 'all' ? model.notes : model.notes.filter((n) => Array.isArray(v.notes) && v.notes.includes(n.id)),
    deps: model.deps
      .map((d) => (d.edges.every((e) => ids.has(e.up.tableId) && ids.has(e.down.tableId)) ? d : { ...d, edges: d.edges.filter((e) => ids.has(e.up.tableId) && ids.has(e.down.tableId)) }))
      .filter((d) => d.edges.length),
  };
}
