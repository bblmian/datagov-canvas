import { createContext, useContext } from 'react';
import type { DEnum, DiagramModel } from '../dbml/types';

export interface Hover {
  tableId?: string;
  fieldId?: string;
  refId?: string;
}

export interface CanvasState {
  enums: Map<string, DEnum>;
  hover: Hover;
  setHover(h: Hover): void;
  /** refs highlighted by the current hover/selection */
  activeRefs: Set<string>;
  /** fields at either end of an active ref */
  activeFields: Set<string>;
  /** something is hovered/selected, so non-active items may be dimmed */
  focusing: boolean;
}

export const CanvasContext = createContext<CanvasState>({
  enums: new Map(),
  hover: {},
  setHover: () => undefined,
  activeRefs: new Set(),
  activeFields: new Set(),
  focusing: false,
});

export const useCanvas = () => useContext(CanvasContext);

export function computeActive(model: DiagramModel, hover: Hover, selectedTables: Set<string>) {
  const activeRefs = new Set<string>();
  const activeFields = new Set<string>();
  for (const r of model.refs) {
    const ends = [r.from, r.to];
    const hit =
      r.id === hover.refId ||
      (hover.fieldId && ends.some((e) => e.fieldIds.includes(hover.fieldId!))) ||
      (!hover.fieldId && hover.tableId && ends.some((e) => e.tableId === hover.tableId)) ||
      ends.some((e) => selectedTables.has(e.tableId));
    if (!hit) continue;
    activeRefs.add(r.id);
    for (const e of ends) for (const f of e.fieldIds) activeFields.add(f);
  }
  return { activeRefs, activeFields, focusing: !!(hover.tableId || hover.fieldId || hover.refId || selectedTables.size) };
}
