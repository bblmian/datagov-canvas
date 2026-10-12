import dagre from '@dagrejs/dagre';
import type { XYPosition } from '@xyflow/react';
import type { DiagramModel } from '../dbml/types';

type Size = { width: number; height: number };

/**
 * Left-to-right layered layout: referenced ("one" side) tables to the left of the tables that
 * reference them, TableGroups kept together as dagre clusters. Returns top-left positions.
 */
export function autoLayout(model: DiagramModel, sizeOf: (id: string) => Size): Record<string, XYPosition> {
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: true });
  g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 110, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const t of model.tables) g.setNode(t.id, sizeOf(t.id));
  for (const grp of model.groups) {
    if (!grp.tableIds.length) continue;
    g.setNode(grp.id, { label: grp.name, paddingTop: 40 });
    for (const tid of grp.tableIds) if (g.hasNode(tid)) g.setParent(tid, grp.id);
  }
  for (const n of model.notes) g.setNode(n.id, sizeOf(n.id));

  for (const r of model.refs) {
    if (r.from.tableId === r.to.tableId || !g.hasNode(r.from.tableId) || !g.hasNode(r.to.tableId)) continue;
    // edge from the "one" side to the "many" side so parents land on the left
    const fromIsOne = !r.from.relation.includes('*') && r.to.relation.includes('*');
    const [a, b] = fromIsOne ? [r.from.tableId, r.to.tableId] : [r.to.tableId, r.from.tableId];
    g.setEdge(a, b, {}, r.id);
  }

  dagre.layout(g);

  const out: Record<string, XYPosition> = {};
  for (const id of [...model.tables.map((t) => t.id), ...model.notes.map((n) => n.id)]) {
    const n = g.node(id);
    if (n) out[id] = { x: Math.round(n.x - n.width / 2), y: Math.round(n.y - n.height / 2) };
  }
  return out;
}

/** Places items that have no saved position in a column to the right of everything else. */
export function placeNew(ids: string[], existing: Record<string, XYPosition>, sizeOf: (id: string) => Size): Record<string, XYPosition> {
  let maxRight = 0;
  let minTop = Infinity;
  for (const [id, p] of Object.entries(existing)) {
    maxRight = Math.max(maxRight, p.x + sizeOf(id).width);
    minTop = Math.min(minTop, p.y);
  }
  if (minTop === Infinity) minTop = 0;
  const x = maxRight + 80;
  let y = minTop;
  const out: Record<string, XYPosition> = {};
  for (const id of ids) {
    out[id] = { x, y };
    y += sizeOf(id).height + 40;
  }
  return out;
}
