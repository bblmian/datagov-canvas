import { Position, type Edge, type Node, type XYPosition } from '@xyflow/react';
import type { DGroup, DiagramModel, DNote, DRef, DTable } from '../dbml/types';
import type { DisplayMode } from '../storage';
import { GROUP_HEADER_H, GROUP_PAD, estimateNoteSize, estimateTableSize, visibleFields } from './geometry';

export type TableNodeData = { table: DTable; mode: DisplayMode };
export type GroupNodeData = { group: DGroup };
export type NoteNodeData = { note: DNote };
export type RelationEdgeData = { ref: DRef };

export type TableNode = Node<TableNodeData, 'table'>;
// not 'group': React Flow ships default styles for .react-flow__node-group
export type GroupNode = Node<GroupNodeData, 'tablegroup'>;
export type NoteNode = Node<NoteNodeData, 'note'>;
export type AnyNode = TableNode | GroupNode | NoteNode;
export type RelationEdge = Edge<RelationEdgeData, 'relation'>;

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
 * previous nodes — dropping `measured` would leave nodes invisible until re-measured.
 */
export function buildNodes(model: DiagramModel, positions: Record<string, XYPosition>, mode: DisplayMode, prev: AnyNode[]): AnyNode[] {
  const prevById = new Map(prev.map((n) => [n.id, n]));
  const keep = (id: string) => {
    const p = prevById.get(id);
    return p ? { measured: p.measured, selected: p.selected } : {};
  };
  const tables: TableNode[] = model.tables.map((table) => {
    const p = prevById.get(table.id) as TableNode | undefined;
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
  const notes: NoteNode[] = model.notes.map((note) => ({
    id: note.id,
    type: 'note',
    position: positions[note.id] ?? { x: 0, y: 0 },
    data: { note },
    zIndex: 1,
    ...keep(note.id),
  }));
  const groups: GroupNode[] = model.groups
    .filter((g) => g.tableIds.length)
    .map((group) => ({ id: group.id, type: 'tablegroup', position: { x: 0, y: 0 }, data: { group }, zIndex: -1, selectable: false, ...keep(group.id) }));
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
 */
export function buildEdges(model: DiagramModel, nodes: AnyNode[], mode: DisplayMode): RelationEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const tableById = new Map(model.tables.map((t) => [t.id, t]));
  const anchor = (tableId: string, fieldId: string) => {
    const t = tableById.get(tableId);
    return t && visibleFields(t, mode).some((f) => f.id === fieldId) ? fieldId : tableId;
  };
  const edges: RelationEdge[] = [];
  for (const ref of model.refs) {
    const a = byId.get(ref.from.tableId);
    const b = byId.get(ref.to.tableId);
    if (!a || !b) continue;
    const sa = sizeOfNode(a);
    const sb = sizeOfNode(b);
    let sideA: 'l' | 'r';
    let sideB: 'l' | 'r';
    if (a.id === b.id) {
      sideA = sideB = 'r';
    } else if (a.position.x + sa.width + 30 < b.position.x) {
      sideA = 'r'; sideB = 'l';
    } else if (b.position.x + sb.width + 30 < a.position.x) {
      sideA = 'l'; sideB = 'r';
    } else {
      // overlapping horizontally: leave and enter on the same side
      const centerA = a.position.x + sa.width / 2;
      const centerB = b.position.x + sb.width / 2;
      sideA = sideB = centerA <= centerB ? 'l' : 'r';
    }
    edges.push({
      id: ref.id,
      type: 'relation',
      source: a.id,
      target: b.id,
      sourceHandle: handleId(anchor(a.id, ref.from.fieldIds[0]), 's', sideA),
      targetHandle: handleId(anchor(b.id, ref.to.fieldIds[0]), 't', sideB),
      data: { ref },
      // below tables (zIndex 1), above group backgrounds (zIndex -1)
      zIndex: 0,
    });
  }
  return edges;
}

export const sidePosition = (side: 'l' | 'r') => (side === 'l' ? Position.Left : Position.Right);
