import { Position, type Edge, type Node, type XYPosition } from '@xyflow/react';
import type { DDep, DGroup, DiagramModel, DNote, DRef, DTable } from '../dbml/types';
import type { DisplayMode } from '../storage';
import { GROUP_HEADER_H, GROUP_PAD, estimateNoteSize, estimateTableSize, visibleFields } from './geometry';

export type TableNodeData = { table: DTable; mode: DisplayMode };
export type GroupNodeData = { group: DGroup };
export type NoteNodeData = { note: DNote };
export type RelationEdgeData = { ref: DRef };
export type DepEdgeData = { dep: DDep; index: number };

export type TableNode = Node<TableNodeData, 'table'>;
// not 'group': React Flow ships default styles for .react-flow__node-group
export type GroupNode = Node<GroupNodeData, 'tablegroup'>;
export type NoteNode = Node<NoteNodeData, 'note'>;
export type AnyNode = TableNode | GroupNode | NoteNode;
export type RelationEdge = Edge<RelationEdgeData, 'relation'>;
export type DepEdge = Edge<DepEdgeData, 'dep'>;
export type AnyEdge = RelationEdge | DepEdge;

/** Handle ids: `${fieldId or tableId}|s|l` = source handle on the left side, etc. */
export const handleId = (owner: string, kind: 's' | 't', side: 'l' | 'r') => `${owner}|${kind}|${side}`;

export function sizeOfNode(n: AnyNode | undefined) {
  if (!n) return { width: 220, height: 120 };
  if (n.measured?.width && n.measured?.height) return { width: n.measured.width, height: n.measured.height };
  if (n.type === 'table') return estimateTableSize(n.data.table, n.data.mode);
  if (n.type === 'note') return estimateNoteSize(n.data.note.content);
  return { width: n.width ?? 0, height: n.height ?? 0 };
}

/**
 * Rebuilds nodes from the model, keeping React Flow's measured sizes (and selection) from the
 * previous nodes — dropping `measured` would leave nodes invisible until re-measured. A node whose
 * data and position are unchanged is returned as the same object, so it doesn't re-render (the
 * model shares unchanged parts between parses, see `reuseUnchanged`).
 */
export function buildNodes(model: DiagramModel, positions: Record<string, XYPosition>, mode: DisplayMode, prev: AnyNode[]): AnyNode[] {
  const prevById = new Map(prev.map((n) => [n.id, n]));
  const keep = (id: string) => {
    const p = prevById.get(id);
    return p ? { measured: p.measured, selected: p.selected } : {};
  };
  const samePlace = (n: AnyNode, id: string) => {
    const pos = positions[id] ?? { x: 0, y: 0 };
    return n.position.x === pos.x && n.position.y === pos.y;
  };
  const tables: TableNode[] = model.tables.map((table) => {
    const p = prevById.get(table.id) as TableNode | undefined;
    if (p && p.data.table === table && p.data.mode === mode && samePlace(p, table.id)) return p;
    // measured height is stale when the visible field list changed
    const sameShape = p && p.data.mode === mode && p.data.table.fields.length === table.fields.length;
    return {
      id: table.id,
      type: 'table',
      position: positions[table.id] ?? { x: 0, y: 0 },
      data: { table, mode },
      zIndex: 1,
      ...(sameShape ? keep(table.id) : { selected: p?.selected }),
    };
  });
  const notes: NoteNode[] = model.notes.map((note) => {
    const p = prevById.get(note.id) as NoteNode | undefined;
    if (p && p.data.note === note && samePlace(p, note.id)) return p;
    return {
      id: note.id,
      type: 'note',
      position: positions[note.id] ?? { x: 0, y: 0 },
      data: { note },
      zIndex: 1,
      ...keep(note.id),
    };
  });
  const groups: GroupNode[] = model.groups
    .filter((g) => g.tableIds.length)
    .map((group) => {
      const p = prevById.get(group.id) as GroupNode | undefined;
      // position and size are recomputed by syncGroups, which keeps the node if they still fit
      if (p && p.data.group === group) return p;
      return { id: group.id, type: 'tablegroup', position: { x: 0, y: 0 }, data: { group }, zIndex: -1, selectable: false, ...keep(group.id) };
    });
  return syncGroups([...groups, ...tables, ...notes]);
}

/** Fits every group node around its member tables. */
export function syncGroups(nodes: AnyNode[]): AnyNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes.map((n) => {
    if (n.type !== 'tablegroup') return n;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const tid of n.data.group.tableIds) {
      const t = byId.get(tid);
      if (!t) continue;
      const s = sizeOfNode(t);
      x0 = Math.min(x0, t.position.x);
      y0 = Math.min(y0, t.position.y);
      x1 = Math.max(x1, t.position.x + s.width);
      y1 = Math.max(y1, t.position.y + s.height);
    }
    if (x0 === Infinity) return n;
    const position = { x: x0 - GROUP_PAD, y: y0 - GROUP_PAD - GROUP_HEADER_H };
    const width = x1 - x0 + GROUP_PAD * 2;
    const height = y1 - y0 + GROUP_PAD * 2 + GROUP_HEADER_H;
    if (n.position.x === position.x && n.position.y === position.y && n.width === width && n.height === height) return n;
    return { ...n, position, width, height };
  });
}

/**
 * One edge per Ref, attached to the referenced columns (or to the table header when columns are
 * hidden). Sides are picked from the current table positions so lines take the short way round.
 * Edges identical to one in `prev` are returned as that object, and if nothing changed at all
 * `prev` itself is returned.
 */
export function buildEdges(model: DiagramModel, nodes: AnyNode[], mode: DisplayMode, prev: AnyEdge[] = []): AnyEdge[] {
  const prevById = new Map(prev.map((e) => [e.id, e]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const tableById = new Map(model.tables.map((t) => [t.id, t]));
  const anchor = (tableId: string, fieldId: string | undefined) => {
    const t = tableById.get(tableId);
    return fieldId && t && visibleFields(t, mode).some((f) => f.id === fieldId) ? fieldId : tableId;
  };
  const sides = (a: AnyNode, b: AnyNode): ['l' | 'r', 'l' | 'r'] => {
    const sa = sizeOfNode(a);
    const sb = sizeOfNode(b);
    if (a.id === b.id) return ['r', 'r'];
    if (a.position.x + sa.width + 30 < b.position.x) return ['r', 'l'];
    if (b.position.x + sb.width + 30 < a.position.x) return ['l', 'r'];
    // overlapping horizontally: leave and enter on the same side
    const side = a.position.x + sa.width / 2 <= b.position.x + sb.width / 2 ? 'l' : 'r';
    return [side, side];
  };
  const edges: AnyEdge[] = [];
  /** reuse the previous edge object when nothing about it changed */
  const push = (e: AnyEdge, same: (p: AnyEdge) => boolean) => {
    const p = prevById.get(e.id);
    edges.push(p && p.type === e.type && same(p) && p.source === e.source && p.target === e.target && p.sourceHandle === e.sourceHandle && p.targetHandle === e.targetHandle ? p : e);
  };
  for (const ref of model.refs) {
    const a = byId.get(ref.from.tableId);
    const b = byId.get(ref.to.tableId);
    if (!a || !b) continue;
    const [sideA, sideB] = sides(a, b);
    push({
      id: ref.id,
      type: 'relation',
      source: a.id,
      target: b.id,
      sourceHandle: handleId(anchor(a.id, ref.from.fieldIds[0]), 's', sideA),
      targetHandle: handleId(anchor(b.id, ref.to.fieldIds[0]), 't', sideB),
      data: { ref },
      // below tables (zIndex 1), above group backgrounds (zIndex -1)
      zIndex: 0,
    }, (p) => (p as RelationEdge).data?.ref === ref);
  }
  // dependencies: one edge per Dep edge, from upstream to downstream (table header when table-level)
  for (const dep of model.deps) {
    dep.edges.forEach((de, index) => {
      const a = byId.get(de.up.tableId);
      const b = byId.get(de.down.tableId);
      if (!a || !b) return;
      const [sideA, sideB] = sides(a, b);
      push({
        id: `${dep.id}#${index}`,
        type: 'dep',
        source: a.id,
        target: b.id,
        sourceHandle: handleId(anchor(a.id, de.up.fieldIds[0]), 's', sideA),
        targetHandle: handleId(anchor(b.id, de.down.fieldIds[0]), 't', sideB),
        data: { dep, index },
        zIndex: 0,
      }, (p) => (p as DepEdge).data?.dep === dep);
    });
  }
  return edges.length === prev.length && edges.every((e, i) => e === prev[i]) ? prev : edges;
}

export const sidePosition = (side: 'l' | 'r') => (side === 'l' ? Position.Left : Position.Right);
