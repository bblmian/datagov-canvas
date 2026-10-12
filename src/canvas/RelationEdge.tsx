import { memo, type CSSProperties } from 'react';
import { BaseEdge, Position, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { isMany, isOptional, type Relation } from '../dbml/types';
import type { DepEdge, RelationEdge } from './graph';
import { useCanvas, useHighlight } from './highlight';

/**
 * Crow's-foot cardinality marker drawn inside the edge's own SVG (not via <marker> defs), so it
 * survives image export. `dir` is +1 when the line leaves the table to the right.
 */
function cardinality(x: number, y: number, dir: number, rel: Relation) {
  const parts: string[] = [];
  if (isMany(rel)) {
    parts.push(`M${x + dir * 14},${y} L${x},${y - 7} M${x + dir * 14},${y} L${x},${y + 7}`);
    if (!isOptional(rel) && rel !== '*') parts.push(`M${x + dir * 18},${y - 7} L${x + dir * 18},${y + 7}`);
  } else {
    parts.push(`M${x + dir * 10},${y - 7} L${x + dir * 10},${y + 7}`);
  }
  return parts.join(' ');
}

export const RelationEdgeView = memo(function RelationEdgeView(props: EdgeProps<RelationEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const { highlight } = useCanvas();
  // 2 = highlighted, 1 = dimmed, 0 = normal
  const state = useHighlight((h) => (h.activeRefs.has(id) ? 2 : h.focusing ? 1 : 0));
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10, offset: 28 });
  const ref = data!.ref;
  const cls = `rel${state === 2 ? ' active' : state === 1 ? ' dim' : ''}${ref.inactive ? ' inactive' : ''}`;
  const sDir = sourcePosition === Position.Left ? -1 : 1;
  const tDir = targetPosition === Position.Left ? -1 : 1;
  const optionalFrom = isOptional(ref.from.relation);
  const optionalTo = isOptional(ref.to.relation);

  return (
    <g className={cls} style={ref.color ? ({ '--edge': ref.color } as CSSProperties) : undefined} onMouseEnter={() => highlight.setHover({ refId: id })} onMouseLeave={() => highlight.setHover({})}>
      <title>{`${ref.from.fieldIds.join(', ')}  ${ref.from.relation} — ${ref.to.relation}  ${ref.to.fieldIds.join(', ')}`}</title>
      <BaseEdge id={id} path={path} className="rel-line" interactionWidth={14} />
      <path className="rel-mark" d={cardinality(sourceX, sourceY, sDir, ref.from.relation)} />
      <path className="rel-mark" d={cardinality(targetX, targetY, tDir, ref.to.relation)} />
      {optionalFrom && <circle className="rel-opt" cx={sourceX + sDir * 22} cy={sourceY} r={4} />}
      {optionalTo && <circle className="rel-opt" cx={targetX + tDir * 22} cy={targetY} r={4} />}
    </g>
  );
});

/** A dependency (`Dep`): dashed line from upstream to downstream with an arrowhead at the downstream end. */
export const DepEdgeView = memo(function DepEdgeView(props: EdgeProps<DepEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const dim = useHighlight((h) => h.focusing);
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10, offset: 36 });
  const { dep, index } = data!;
  const e = dep.edges[index];
  const tDir = targetPosition === Position.Left ? -1 : 1;
  const end = (x: { tableId: string; fieldIds: string[] }) => (x.fieldIds.length ? x.fieldIds.join(', ') : x.tableId);
  return (
    <g className={`dep${dim ? ' dim' : ''}`} style={dep.color ? ({ '--dep': dep.color } as CSSProperties) : undefined}>
      <title>{`${dep.name ? `${dep.name}: ` : ''}${end(e.up)} → ${end(e.down)}${dep.note ? `\n${dep.note}` : ''}`}</title>
      <BaseEdge id={id} path={path} className="dep-line" interactionWidth={14} />
      <path className="dep-arrow" d={`M${targetX + tDir * 11},${targetY - 6} L${targetX + tDir * 2},${targetY} L${targetX + tDir * 11},${targetY + 6} Z`} />
    </g>
  );
});
