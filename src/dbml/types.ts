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
  color?: string;
  /** `[inactive]`: documented but not enforced */
  inactive?: boolean;
}

/** One end of a dependency: a table, or some of its columns. */
export interface DDepEnd {
  tableId: string;
  /** empty for a table-level dependency */
  fieldIds: string[];
}

/** A `Dep` (data lineage): each edge says `up` feeds `down`. */
export interface DDep {
  /** `dep:${id}` */
  id: string;
  name?: string;
  color?: string;
  note?: string;
  edges: { up: DDepEnd; down: DDepEnd }[];
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

/** 'all' (`*`), a list of ids/names, or null (none of that kind). */
export type ViewSelection = 'all' | string[] | null;

/**
 * A `DiagramView`: which tables (listed, or via their group or schema) and sticky notes to show.
 * `tables` is 'all' when the view shows every table; `groups` are group ids, `schemas` schema
 * names (`public` for the default one), `notes` note ids.
 */
export interface DView {
  /** `view:${name}` */
  id: string;
  name: string;
  tables: ViewSelection;
  groups: string[] | null;
  schemas: string[] | null;
  notes: ViewSelection;
}

export interface DiagramModel {
  project?: { name?: string; databaseType?: string; note?: string };
  tables: DTable[];
  refs: DRef[];
  groups: DGroup[];
  enums: DEnum[];
  notes: DNote[];
  views: DView[];
  deps: DDep[];
}

/** Character range in the DBML source (JS string offsets, end exclusive). */
export interface Loc {
  start: number;
  end: number;
}

export interface DIndex {
  /** column names; expressions keep their backticks */
  columns: string[];
  unique: boolean;
  pk: boolean;
  name?: string;
  type?: string;
  note?: string;
  loc: Loc;
}

export interface DCheck {
  /** without backticks */
  expression: string;
  name?: string;
  loc: Loc;
}

/** A `Records t(cols) { … }` block (or `records { … }` inside a table); cells as shown to the user. */
export interface DRecords {
  loc: Loc;
  inline: boolean;
  /** `[example]`: sample rows rather than seed data */
  example: boolean;
  columns: string[];
  /** cells as the user sees them (strings unquoted, null empty) */
  rows: string[][];
  /** cells as written in DBML (`'abc'`, `12`, `null`, `` `now()` ``, `status.active`) */
  raw: string[][];
}

/** What tables and TablePartials have in common for editing. */
export interface BlockInfo {
  /** spans `Table … { … }` / `TablePartial … { … }` */
  loc: Loc;
  /** the `note: …` setting or the `Note: …` line inside */
  noteLoc?: Loc;
  indexes: DIndex[];
  checks: DCheck[];
  /** `~partial` injections (tables only) */
  partials: { name: string; loc: Loc }[];
  /** sample data (tables only) */
  records: DRecords[];
}

export interface DPartial extends BlockInfo {
  name: string;
  note?: string;
  headerColor?: string;
  /** own columns; ids are `partial:${name}.${column}` */
  fields: DField[];
}

/**
 * Where everything sits in the source text, plus details only the graphical editor needs. Kept
 * apart from DiagramModel because offsets shift on every keystroke: putting them in the model
 * would defeat `reuseUnchanged` and re-render the whole canvas while typing.
 */
export interface EditInfo {
  tables: Record<string, BlockInfo>;
  partials: Record<string, DPartial>;
  /** a table's own columns and partial columns (`partial:p.c`); columns injected from a partial are absent */
  fields: Record<string, Loc>;
  /** table column id → the partial it comes from */
  injected: Record<string, string>;
  /** `check:` expressions of a column, in order */
  fieldChecks: Record<string, string[]>;
  /** custom `key: value` settings written on a column (values as literals) */
  fieldCustom: Record<string, Record<string, string>>;
  /** the inline `ref:` setting of a column, without `ref:` (e.g. `> users.id`) */
  fieldRef: Record<string, string>;
  /** inline refs (`[ref: > t.c]`) point at the setting, inside the field `ownerFieldId` */
  refs: Record<string, { loc: Loc; inline: boolean; ownerFieldId?: string; onDelete?: string; onUpdate?: string; color?: string }>;
  enums: Record<string, Loc>;
  groups: Record<string, Loc>;
  notes: Record<string, Loc>;
  views: Record<string, Loc>;
  /** `Dep` blocks, or inline `dep:` settings on a column (`owner` is its id) or table (a table id) */
  /** `metadata` values are DBML literals (custom Dep entries may be strings, numbers, booleans or null) */
  deps: Record<string, { loc: Loc; inline: boolean; owner?: { kind: 'field' | 'table'; id: string }; metadata: Record<string, string> }>;
  /** `Metadata <Kind> <target> { … }` blocks, keyed `Table:<id>`, `Column:<id>`, `TableGroup:<id>`, `Note:<id>` */
  metadata: Record<string, { loc: Loc; custom: Record<string, string>; builtins: string[] }>;
  project?: Loc;
  /** `key: value` entries of the Project block other than database_type and Note */
  projectCustom: Record<string, string>;
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
