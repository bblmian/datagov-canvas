// Guards "everything DBML can express can also be done graphically": the element kinds and
// settings are read from the installed DBML grammar (@dbml/parse), and each must map to editing
// operations that exist in edit.ts (the Inspector / canvas call these). A new keyword after a
// library upgrade fails this test until it is handled.
import { describe, expect, it } from 'vitest';
// the installed grammar, as text (the package's exports map hides the file, hence the relative path)
import parser from '../../node_modules/@dbml/parse/dist/dbml-parse.mjs?raw';
import * as E from './edit';

type Op = keyof typeof E;

/** grammar keyword → edit operations covering it */
const ELEMENTS: Record<string, Op[]> = {
  table: ['addTable', 'updateTable', 'deleteTable'],
  enum: ['addEnum', 'updateEnum', 'deleteEnum'],
  ref: ['addRef', 'updateRef', 'deleteRef'],
  dep: ['addDep', 'updateDep', 'deleteDep'],
  note: ['addNote', 'updateNote', 'deleteNote'],
  project: ['setProject', 'deleteProject'],
  indexes: ['addIndex', 'updateIndex', 'deleteIndex'],
  tablegroup: ['addGroup', 'updateGroup', 'deleteGroup'],
  tablepartial: ['addPartial', 'updatePartial', 'deletePartial', 'addPartialToTable', 'removePartialFromTable', 'moveInjection'],
  checks: ['addCheck', 'updateCheck', 'deleteCheck'],
  records: ['setRecords', 'deleteRecords'],
  diagramview: ['addView', 'updateView', 'deleteView'],
  // sub-blocks of a DiagramView
  tables: ['updateView'],
  notes: ['updateView'],
  tablegroups: ['updateView'],
  schemas: ['updateView'],
  metadata: ['setMetadata'],
};

const SETTINGS: Record<string, Op[]> = {
  color: ['updateRef', 'updateGroup', 'updateNote', 'updateDep'],
  headercolor: ['updateTable', 'updatePartial'],
  note: ['updateTable', 'updateField', 'updateIndex', 'updateEnum', 'updateGroup', 'updatePartial', 'updateDep', 'setProject'],
  pk: ['updateField', 'updateIndex'],
  'primary key': ['updateField'],
  unique: ['updateField', 'updateIndex'],
  ref: ['addRef', 'updateRef', 'deleteRef'],
  dep: ['addDep', 'updateDep', 'deleteDep'],
  'not null': ['updateField'],
  null: ['updateField'],
  increment: ['updateField'],
  default: ['updateField'],
  name: ['updateIndex', 'updateCheck'],
  type: ['updateIndex'],
  check: ['updateField', 'addCheck'],
  update: ['updateRef'],
  delete: ['updateRef'],
  inactive: ['updateRef'],
  example: ['setRecords'],
};

/** The string values of the grammar enum whose first member is `first`. */
function grammarEnum(source: string, first: string): string[] {
  const start = source.indexOf(first);
  expect(start, `grammar enum starting with ${first}`).toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf(', e;', start));
  return [...body.matchAll(/e\.\w+ = "([^"]+)"/g)].map((m) => m[1]);
}

describe('graphical editing covers the whole DBML grammar', () => {
  it('every element kind has editing operations', () => {
    const kinds = grammarEnum(parser, 'e.Table = "table"');
    expect(kinds.sort()).toEqual(Object.keys(ELEMENTS).sort());
  });

  it('every setting has editing operations', () => {
    const settings = grammarEnum(parser, 'e.Color = "color"');
    expect(settings.sort()).toEqual(Object.keys(SETTINGS).sort());
  });

  it('all listed operations exist', () => {
    for (const op of [...Object.values(ELEMENTS), ...Object.values(SETTINGS)].flat()) {
      expect(typeof E[op], op).toBe('function');
    }
  });
});
