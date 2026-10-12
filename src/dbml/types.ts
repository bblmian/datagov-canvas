// The renderer-facing model of a parsed DBML document. Built from @dbml/core's normalized model
// (see model.ts) so the canvas never touches @dbml/core directly — that library only runs in the worker.

export interface DField {
  /** `${tableId}.${name}` — also used as the React Flow handle prefix */
  id: string;
  name: string;
  type: string;
  pk: boolean;
  notNull: boolean;
  unique: boolean;
  increment: boolean;
  note?: string;
  defaultValue?: string;
  /** full enum id (see DEnum.id) when the column type is an enum declared in the document */
  enumId?: string;
  /** participates in at least one Ref */
  isRef: boolean;
}

export interface DTable {
  /** `name` for the default schema, `schema.name` otherwise; positions are persisted under this key */
  id: string;
  name: string;
  schema?: string;
  alias?: string;
  note?: string;
  headerColor?: string;
  groupId?: string;
  fields: DField[];
}

/** '1', '*', '0..1', '0..*' … as produced by @dbml/core */
export type Relation = string;

export interface DEndpoint {
  tableId: string;
  fieldIds: string[];
  relation: Relation;
}

export interface DRef {
  id: string;
  name?: string;
  /** first endpoint as written in the source (`from > to`) */
  from: DEndpoint;
  to: DEndpoint;
}

export interface DGroup {
  id: string;
  name: string;
  color?: string;
  note?: string;
  tableIds: string[];
}

export interface DEnum {
  id: string;
  name: string;
  values: { name: string; note?: string }[];
}

export interface DNote {
  /** `note:${name}` */
  id: string;
  name: string;
  content: string;
  color?: string;
}

export interface DiagramModel {
  project?: { name?: string; databaseType?: string; note?: string };
  tables: DTable[];
  refs: DRef[];
  groups: DGroup[];
  enums: DEnum[];
  notes: DNote[];
}

export interface Diagnostic {
  message: string;
  /** 1-based */
  line: number;
  /** 1-based */
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: 'error' | 'warning' | 'info';
}

export const isMany = (r: Relation) => r.includes('*');
export const isOptional = (r: Relation) => r.startsWith('0');
