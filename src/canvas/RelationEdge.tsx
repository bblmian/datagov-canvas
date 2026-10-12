import { memo } from 'react';
import { BaseEdge, Position, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { isMany, isOptional, type Relation } from '../dbml/types';
import type { RelationEdge } from './graph';
import { useCanvas } from './highlight';

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
  const { activeRefs, focusing, setHover } = useCanvas();
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10, offset: 28 });
  const ref = data!.ref;
  const active = activeRefs.has(id);
  const cls = `rel${active ? ' active' : ''}${focusing && !active ? ' dim' : ''}`;
  const sDir = sourcePosition === Position.Left ? -1 : 1;
  const tDir = targetPosition === Position.Left ? -1 : 1;
  const optionalFrom = isOptional(ref.from.relation);
  const optionalTo = isOptional(ref.to.relation);

  return (
    <g className={cls} onMouseEnter={() => setHover({ refId: id })} onMouseLeave={() => setHover({})}>
      <title>{`${ref.from.fieldIds.join(', ')}  ${ref.from.relation} — ${ref.to.relation}  ${ref.to.fieldIds.join(', ')}`}</title>
      <BaseEdge id={id} path={path} className="rel-line" interactionWidth={14} />
      <path className="rel-mark" d={cardinality(sourceX, sourceY, sDir, ref.from.relation)} />
      <path className="rel-mark" d={cardinality(targetX, targetY, tDir, ref.to.relation)} />
      {optionalFrom && <circle className="rel-opt" cx={sourceX + sDir * 22} cy={sourceY} r={4} />}
      {optionalTo && <circle className="rel-opt" cx={targetX + tDir * 22} cy={targetY} r={4} />}
    </g>
  );
});
