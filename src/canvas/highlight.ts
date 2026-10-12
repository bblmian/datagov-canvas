import { createContext, useContext, useSyncExternalStore } from 'react';
import type { DEnum, DiagramModel } from '../dbml/types';

export interface Hover {
  tableId?: string;
  fieldId?: string;
  refId?: string;
}

export interface Highlight {
  /** refs highlighted by the current hover/selection */
  activeRefs: Set<string>;
  /** fields at either end of an active ref */
  activeFields: Set<string>;
  /** something is hovered/selected, so non-active items may be dimmed */
  focusing: boolean;
  hoverTableId?: string;
}

const NONE: Highlight = { activeRefs: new Set(), activeFields: new Set(), focusing: false };

/**
 * Hover/selection highlighting, kept outside React state: each node and edge subscribes to the
 * one value it renders (`useHighlight`), so hovering re-renders only what actually changes
 * instead of every node and edge on the canvas.
 */
export class HighlightStore {
  state: Highlight = NONE;
  private model: DiagramModel | null = null;
  private hover: Hover = {};
  private selected = new Set<string>();
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  setHover = (h: Hover) => {
    const o = this.hover;
    if (o.tableId === h.tableId && o.fieldId === h.fieldId && o.refId === h.refId) return;
    this.hover = h;
    this.update();
  };

  setModel(model: DiagramModel | null) {
    if (model === this.model) return;
    this.model = model;
    this.update();
  }

  setSelected(tableIds: Set<string>) {
    this.selected = tableIds;
    this.update();
  }

  private update() {
    this.state = this.model ? computeActive(this.model, this.hover, this.selected) : NONE;
    for (const fn of this.listeners) fn();
  }
}

export interface CanvasState {
  enums: Map<string, DEnum>;
  highlight: HighlightStore;
  /** dragging from a dot creates a Ref, or (in dependency mode) a Dep — then table headers get dots too */
  connectKind: 'ref' | 'dep';
}

export const CanvasContext = createContext<CanvasState>({ enums: new Map(), highlight: new HighlightStore(), connectKind: 'ref' });

export const useCanvas = () => useContext(CanvasContext);

/** Subscribes to one value derived from the highlight; return a primitive so unchanged values skip the re-render. */
export function useHighlight<T extends string | number | boolean>(select: (h: Highlight) => T): T {
  const { highlight } = useCanvas();
  return useSyncExternalStore(highlight.subscribe, () => select(highlight.state));
}

export function computeActive(model: DiagramModel, hover: Hover, selectedTables: Set<string>): Highlight {
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
  return {
    activeRefs,
    activeFields,
    focusing: !!(hover.tableId || hover.fieldId || hover.refId || selectedTables.size),
    hoverTableId: hover.tableId,
  };
}
