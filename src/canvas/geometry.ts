import type { DisplayMode } from '../storage';
import type { DField, DTable } from '../dbml/types';

// Sizes must match .tbl styles in styles.css; they are used before React Flow has measured a
// node (initial layout, group bounds) and as the fallback afterwards.
export const HEADER_H = 36;
export const ROW_H = 28;
export const TABLE_MIN_W = 220;
export const NOTE_W = 240;
export const GROUP_PAD = 24;
export const GROUP_HEADER_H = 30;

export function visibleFields(table: DTable, mode: DisplayMode): DField[] {
  if (mode === 'names') return [];
  if (mode === 'keys') return table.fields.filter((f) => f.pk || f.isRef);
  return table.fields;
}

/** Rough size estimate; React Flow's measured size replaces it once rendered. */
export function estimateTableSize(table: DTable, mode: DisplayMode) {
  const fields = visibleFields(table, mode);
  const chars = Math.max(
    (table.schema ? table.schema.length + 1 : 0) + table.name.length + 4,
    ...fields.map((f) => f.name.length + f.type.length + 6),
  );
  return { width: Math.max(TABLE_MIN_W, Math.round(chars * 7.4) + 40), height: HEADER_H + fields.length * ROW_H + (fields.length ? 4 : 0) };
}

export function estimateNoteSize(content: string) {
  const lines = content.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 30)), 0);
  return { width: NOTE_W, height: 40 + lines * 20 };
}
