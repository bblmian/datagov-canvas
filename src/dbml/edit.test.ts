import { describe, expect, it } from 'vitest';
import { Parser } from '@dbml/core';
import { toDiagramModel } from './model';
import { toEditInfo } from './editinfo';
import * as E from './edit';
import type { EditCtx } from './edit';
import { applyView } from './views';
import { literalFor } from './text';

function ctx(source: string): EditCtx {
  const db = Parser.parse(source, 'dbmlv2');
  return { source, model: toDiagramModel(db.normalize() as never, (db as unknown as { diagramViews: never[] }).diagramViews), info: toEditInfo(db as never, source) };
}
/** Applies an edit and checks that the result still parses. */
function run(source: string, fn: (c: EditCtx) => E.EditResult) {
  const r = fn(ctx(source));
  const after = ctx(r.source);
  return { ...r, model: after.model, info: after.info };
}
/** Refs in a canonical form: `a > b` (a references b), `a - b` / `a <> b` with the ends sorted. */
const rel = (m: ReturnType<typeof ctx>['model']) =>
  m.refs.map((r) => {
    let a = r.from.fieldIds.join('+');
    let b = r.to.fieldIds.join('+');
    let op = E.refOp(r.from.relation, r.to.relation);
    if (op === '<' || ((op === '-' || op === '<>') && a > b)) [a, b] = [b, a];
    if (op === '<') op = '>';
    return `${a} ${op} ${b}`;
  }).sort();

const BASE = `// header comment
Table users {
  id integer [pk, increment] // the key
  name varchar [not null]
}

Table posts [note: 'blog posts'] {
  id int [pk]
  user_id int [ref: > users.id]
  title text
}

Ref: posts.title - users.name
`;

describe('tables', () => {
  it('adds a table with a unique name', () => {
    const r = run(BASE, (c) => E.addTable(c));
    expect(r.created).toBe('table_1');
    expect(r.model.tables.map((t) => t.id)).toEqual(['users', 'posts', 'table_1']);
    expect(r.source.startsWith(BASE)).toBe(true);
  });

  it('adds a table to an empty document', () => {
    const r = run('', (c) => E.addTable(c));
    expect(r.model.tables[0].fields[0]).toMatchObject({ name: 'id', pk: true, increment: true });
  });

  it('renames a table and updates every reference to it', () => {
    const r = run(BASE, (c) => E.updateTable(c, 'users', { name: 'members' }));
    expect(r.renamed).toEqual({ users: 'members' });
    expect(r.model.tables.map((t) => t.id)).toEqual(['members', 'posts']);
    expect(rel(r.model)).toEqual(['members.name - posts.title', 'posts.user_id > members.id']);
    expect(r.source).toContain('// header comment');
    expect(r.source).toContain('// the key');
  });

  it('renames into a schema', () => {
    const r = run(BASE, (c) => E.updateTable(c, 'users', { name: 'auth.users' }));
    expect(r.renamed).toEqual({ users: 'auth.users' });
    expect(r.model.tables[0]).toMatchObject({ id: 'auth.users', schema: 'auth', name: 'users' });
  });

  it('refuses a duplicate name', () => {
    expect(() => E.updateTable(ctx(BASE), 'users', { name: 'posts' })).toThrow();
  });

  it('sets and clears note and header color in the header', () => {
    let r = run(BASE, (c) => E.updateTable(c, 'users', { note: "people's table", headerColor: '#ff0000' }));
    expect(r.model.tables[0]).toMatchObject({ note: "people's table", headerColor: '#ff0000' });
    r = run(r.source, (c) => E.updateTable(c, 'posts', { note: '' }));
    expect(r.model.tables[1].note).toBeUndefined();
    r = run(r.source, (c) => E.updateTable(c, 'users', { headerColor: '' }));
    expect(r.model.tables[0].headerColor).toBeUndefined();
  });

  it('edits a note written inside the table body', () => {
    const src = `Table a {\n  id int\n  Note: 'old'\n}\n`;
    expect(run(src, (c) => E.updateTable(c, 'a', { note: 'new' })).model.tables[0].note).toBe('new');
    const cleared = run(src, (c) => E.updateTable(c, 'a', { note: '' }));
    expect(cleared.model.tables[0].note).toBeUndefined();
    expect(cleared.source).toBe('Table a {\n  id int\n}\n');
  });

  it('keeps the alias and unknown settings', () => {
    const src = `Table users as U [headercolor: #111111] {\n  id int [pk]\n}\nTable p {\n  u int [ref: > U.id]\n}\n`;
    const r = run(src, (c) => E.updateTable(c, 'users', { name: 'people' }));
    expect(r.model.tables[0]).toMatchObject({ id: 'people', alias: 'U', headerColor: '#111111' });
    expect(rel(r.model)).toEqual(['p.u > people.id']);
  });

  it('deletes a table with its refs and group membership', () => {
    const src = `${BASE}\nTableGroup g {\n  users\n  posts\n}\n`;
    const r = run(src, (c) => E.deleteTable(c, 'users'));
    expect(r.removed).toEqual(['users']);
    expect(r.model.tables.map((t) => t.id)).toEqual(['posts']);
    expect(r.model.refs).toEqual([]);
    expect(r.model.groups[0].tableIds).toEqual(['posts']);
    expect(r.source).toContain('user_id int\n');
  });
});

describe('fields', () => {
  it('adds a field after the last one, with the same indentation', () => {
    const r = run(BASE, (c) => E.addField(c, 'users'));
    expect(r.created).toBe('users.column_1');
    expect(r.model.tables[0].fields.map((f) => f.name)).toEqual(['id', 'name', 'column_1']);
    expect(r.source).toContain('  name varchar [not null]\n  column_1 varchar\n}');
  });

  it('refuses to delete the last column (DBML has no empty tables)', () => {
    expect(() => E.deleteField(ctx('Table e {\n  id int\n}\n'), 'e.id')).toThrow(E.EditError);
  });

  it('adds a field before Indexes and body notes', () => {
    const src = `Table t {\n  a int\n  Indexes {\n    a\n  }\n  Note: 'n'\n}\n`;
    const r = run(src, (c) => E.addField(c, 't'));
    expect(r.model.tables[0].fields.map((f) => f.name)).toEqual(['a', 'column_1']);
    expect(r.info.tables.t.indexes).toHaveLength(1);
  });

  it('toggles flags and keeps other settings', () => {
    let r = run(BASE, (c) => E.updateField(c, 'posts.user_id', { notNull: true, unique: true }));
    expect(r.model.tables[1].fields[1]).toMatchObject({ notNull: true, unique: true, isRef: true });
    expect(rel(r.model)).toContain('posts.user_id > users.id');
    r = run(r.source, (c) => E.updateField(c, 'users.id', { pk: false, increment: false }));
    expect(r.model.tables[0].fields[0]).toMatchObject({ pk: false, increment: false });
    expect(r.source).toContain('id integer // the key');
  });

  it('sets type, default and note', () => {
    let r = run(BASE, (c) => E.updateField(c, 'users.name', { type: 'varchar(255)', defaultValue: 'anon', note: 'display name' }));
    expect(r.model.tables[0].fields[1]).toMatchObject({ type: 'varchar(255)', defaultValue: "'anon'", note: 'display name', notNull: true });
    r = run(r.source, (c) => E.updateField(c, 'users.name', { type: 'double precision', defaultValue: '`now()`' }));
    expect(r.model.tables[0].fields[1]).toMatchObject({ type: 'double precision', defaultValue: '`now()`' });
    r = run(r.source, (c) => E.updateField(c, 'users.name', { defaultValue: '42', note: '' }));
    expect(r.model.tables[0].fields[1]).toMatchObject({ defaultValue: '42' });
    expect(r.model.tables[0].fields[1].note).toBeUndefined();
  });

  it('renames a field and the refs and indexes that use it', () => {
    const src = `${BASE}Table x {\n  a int\n  b int\n  Indexes {\n    (a, b) [unique]\n  }\n}\n`;
    let r = run(src, (c) => E.updateField(c, 'users.id', { name: 'user id' }));
    expect(r.model.tables[0].fields[0].name).toBe('user id');
    expect(rel(r.model)).toEqual(['posts.title - users.name', 'posts.user_id > users.user id']);
    expect(r.source).toContain('[ref: > users."user id"]');
    r = run(r.source, (c) => E.updateField(c, 'x.a', { name: 'aa' }));
    expect(r.info.tables.x.indexes[0]).toMatchObject({ columns: ['aa', 'b'], unique: true });
  });

  it('deletes a field with its refs and indexes', () => {
    const src = `${BASE}Table x {\n  a int\n  b int\n  Indexes {\n    a\n  }\n}\n`;
    let r = run(src, (c) => E.deleteField(c, 'users.id'));
    expect(r.model.tables[0].fields.map((f) => f.name)).toEqual(['name']);
    expect(rel(r.model)).toEqual(['posts.title - users.name']);
    r = run(r.source, (c) => E.deleteField(c, 'x.a'));
    expect(r.info.tables.x.indexes).toEqual([]);
    expect(r.source).not.toContain('Indexes');
  });

  it('moves a field up and down', () => {
    let r = run(BASE, (c) => E.moveField(c, 'users.name', -1));
    expect(r.model.tables[0].fields.map((f) => f.name)).toEqual(['name', 'id']);
    r = run(r.source, (c) => E.moveField(c, 'users.name', 1));
    expect(r.model.tables[0].fields.map((f) => f.name)).toEqual(['id', 'name']);
  });
});

describe('indexes', () => {
  it('adds the first index as a new Indexes block, then more', () => {
    let r = run(BASE, (c) => E.addIndex(c, 'posts', { columns: ['user_id', 'title'], unique: true }));
    expect(r.info.tables.posts.indexes[0]).toMatchObject({ columns: ['user_id', 'title'], unique: true });
    r = run(r.source, (c) => E.addIndex(c, 'posts', { columns: ['title'] }));
    expect(r.info.tables.posts.indexes.map((i) => i.columns)).toEqual([['user_id', 'title'], ['title']]);
    r = run(r.source, (c) => E.updateIndex(c, 'posts', 1, { unique: true }));
    expect(r.info.tables.posts.indexes[1].unique).toBe(true);
    r = run(r.source, (c) => E.deleteIndex(c, 'posts', 0));
    r = run(r.source, (c) => E.deleteIndex(c, 'posts', 0));
    expect(r.source).not.toContain('Indexes');
  });

  it('a composite pk index makes its columns pk', () => {
    const r = run(BASE, (c) => E.addIndex(c, 'posts', { columns: ['user_id', 'title'], pk: true }));
    expect(r.model.tables[1].fields.filter((f) => f.pk).map((f) => f.name)).toEqual(['id', 'user_id', 'title']);
  });
});

describe('refs', () => {
  it('adds a ref statement', () => {
    const r = run(BASE, (c) => E.addRef(c, 'posts.id', 'users.id'));
    expect(rel(r.model)).toContain('posts.id > users.id');
    expect(r.source.endsWith('Ref: posts.title - users.name\nRef: posts.id > users.id\n')).toBe(true);
  });

  it('changes the relation of a standalone ref and sets actions', () => {
    const refId = ctx(BASE).model.refs.find((r) => r.from.fieldIds[0] === 'posts.title')!.id;
    const r = run(BASE, (c) => E.updateRef(c, refId, { op: '<>', onDelete: 'cascade' }));
    expect(rel(r.model)).toContain('posts.title <> users.name');
    expect(r.source).toContain('[delete: cascade]');
    const back = run(r.source, (c) => E.updateRef(c, c.model.refs.find((x) => x.from.fieldIds[0] === 'posts.title')!.id, { onDelete: '' }));
    expect(back.source).not.toContain('delete:');
  });

  it('changes an inline ref in place', () => {
    const refId = ctx(BASE).model.refs.find((r) => r.to.fieldIds[0] === 'posts.user_id' || r.from.fieldIds[0] === 'posts.user_id')!.id;
    const r = run(BASE, (c) => E.updateRef(c, refId, { op: '-' }));
    expect(r.source).toContain('user_id int [ref: - users.id]');
    expect(rel(r.model)).toContain('posts.user_id - users.id');
  });

  it('moves an inline ref out when it gets actions or is swapped', () => {
    const refId = ctx(BASE).model.refs.find((r) => r.to.fieldIds[0] === 'posts.user_id' || r.from.fieldIds[0] === 'posts.user_id')!.id;
    const r = run(BASE, (c) => E.updateRef(c, refId, { onDelete: 'set null' }));
    expect(r.source).toContain('user_id int\n');
    expect(r.source).toContain('Ref: posts.user_id > users.id [delete: set null]');
    expect(r.model.refs).toHaveLength(2);
  });

  it('swaps the ends', () => {
    const refId = ctx(BASE).model.refs.find((r) => r.from.fieldIds[0] === 'posts.title')!.id;
    const r = run(BASE, (c) => E.updateRef(c, refId, { op: '>', swap: true }));
    expect(rel(r.model)).toContain('posts.title > users.name');
    expect(r.source).toContain('Ref: users.name < posts.title');
  });

  it('deletes standalone and inline refs', () => {
    let r = run(BASE, (c) => E.deleteRef(c, c.model.refs.find((x) => !c.info.refs[x.id].inline)!.id));
    expect(r.model.refs).toHaveLength(1);
    r = run(r.source, (c) => E.deleteRef(c, c.model.refs[0].id));
    expect(r.model.refs).toHaveLength(0);
    expect(r.source).toContain('user_id int\n');
  });
});

describe('enums, notes, groups', () => {
  it('creates, edits, renames and deletes an enum', () => {
    let r = run(BASE, (c) => E.addEnum(c));
    expect(r.model.enums[0]).toMatchObject({ id: 'enum_1', values: [{ name: 'value_1' }, { name: 'value_2' }] });
    r = run(r.source, (c) => E.updateField(c, 'posts.title', { type: 'enum_1' }));
    r = run(r.source, (c) => E.updateEnum(c, 'enum_1', { name: 'status', values: [{ name: 'draft' }, { name: 'published', note: "it's live" }] }));
    expect(r.model.enums[0]).toMatchObject({ id: 'status', values: [{ name: 'draft' }, { name: 'published', note: "it's live" }] });
    expect(r.model.tables[1].fields[2]).toMatchObject({ type: 'status', enumId: 'status' });
    r = run(r.source, (c) => E.deleteEnum(c, 'status'));
    expect(r.model.enums).toEqual([]);
  });

  it('creates, edits and deletes a sticky note', () => {
    let r = run(BASE, (c) => E.addNote(c, 'hello'));
    expect(r.created).toBe('note:note_1');
    r = run(r.source, (c) => E.updateNote(c, 'note:note_1', { name: 'todo', content: 'line 1\nline 2', color: '#fde68a' }));
    expect(r.renamed).toEqual({ 'note:note_1': 'note:todo' });
    expect(r.model.notes[0]).toMatchObject({ id: 'note:todo', content: 'line 1\nline 2', color: '#fde68a' });
    r = run(r.source, (c) => E.deleteNote(c, 'note:todo'));
    expect(r.model.notes).toEqual([]);
  });

  it('creates and edits groups; a table moves between groups', () => {
    let r = run(BASE, (c) => E.addGroup(c, ['users']));
    expect(r.model.groups[0]).toMatchObject({ id: 'group:group_1', tableIds: ['users'] });
    r = run(r.source, (c) => E.addGroup(c, ['users', 'posts']));
    expect(r.model.groups.map((g) => [g.name, g.tableIds])).toEqual([['group_1', []], ['group_2', ['users', 'posts']]]);
    r = run(r.source, (c) => E.updateGroup(c, 'group:group_1', { name: 'auth', color: '#16a34a', note: 'login', tableIds: ['users'] }));
    expect(r.model.groups.map((g) => [g.name, g.tableIds])).toEqual([['auth', ['users']], ['group_2', ['posts']]]);
    expect(r.model.groups[0]).toMatchObject({ color: '#16a34a', note: 'login' });
    r = run(r.source, (c) => E.deleteGroup(c, 'group:auth'));
    expect(r.model.groups.map((g) => g.name)).toEqual(['group_2']);
    expect(r.model.tables).toHaveLength(2);
  });
});

describe('text details', () => {
  it('quotes names and strings that need it', () => {
    expect(E.ident('plain_1')).toBe('plain_1');
    expect(E.ident('has space')).toBe('"has space"');
    expect(E.str("it's")).toBe("'it\\'s'");
    expect(E.str('a\nb')).toBe("'''a\nb'''");
  });

  it('works with CRLF line endings and non-ASCII text before the edit', () => {
    const src = '// 中文注释 😀\r\nTable a {\r\n  id int\r\n}\r\n';
    const r = run(src, (c) => E.updateField(c, 'a.id', { pk: true }));
    expect(r.model.tables[0].fields[0].pk).toBe(true);
    expect(r.source).toBe('// 中文注释 😀\r\nTable a {\r\n  id int [pk]\r\n}\r\n');
  });
});

describe('aliases, named / coloured / composite refs', () => {
  it('sets, changes and removes a table alias', () => {
    let r = run(BASE, (c) => E.updateTable(c, 'users', { alias: 'U' }));
    expect(r.model.tables[0].alias).toBe('U');
    expect(r.source).toContain('Table users as U {');
    r = run(r.source, (c) => E.updateTable(c, 'users', { alias: '' }));
    expect(r.model.tables[0].alias).toBeUndefined();
  });

  it('names and colours a standalone ref', () => {
    const id = ctx(BASE).model.refs.find((x) => x.from.fieldIds[0] === 'posts.title')!.id;
    const r = run(BASE, (c) => E.updateRef(c, id, { name: 'fk_title', color: '#ff0000' }));
    expect(r.source).toContain('Ref fk_title: posts.title - users.name [color: #ff0000]');
    expect(r.model.refs.find((x) => x.name === 'fk_title')).toMatchObject({ color: '#ff0000' });
  });

  it('moves a named inline ref out into a statement', () => {
    const c0 = ctx(BASE);
    const id = c0.model.refs.find((x) => c0.info.refs[x.id].inline)!.id;
    const r = run(BASE, (c) => E.updateRef(c, id, { name: 'fk_user' }));
    expect(r.source).toContain('user_id int\n');
    expect(r.model.refs.find((x) => x.name === 'fk_user')).toBeTruthy();
  });

  it('creates and edits a composite (multi-column) ref', () => {
    const src = `Table a {\n  x int\n  y int\n  z int\n}\nTable b {\n  x int\n  y int\n  z int\n}\n`;
    let r = run(src, (c) => E.addRef(c, ['b.x', 'b.y'], ['a.x', 'a.y'], '>', 'fk_xy'));
    expect(r.source).toContain('Ref fk_xy: b.(x, y) > a.(x, y)');
    expect(r.model.refs[0].from.fieldIds).toEqual(['b.x', 'b.y']);
    r = run(r.source, (c) => E.updateRef(c, c.model.refs[0].id, { from: ['b.x', 'b.y', 'b.z'], to: ['a.x', 'a.y', 'a.z'] }));
    expect(r.source).toContain('Ref fk_xy: b.(x, y, z) > a.(x, y, z)');
    expect(() => E.updateRef(ctx(r.source), ctx(r.source).model.refs[0].id, { from: ['b.x'] })).toThrow(E.EditError);
    // renaming a column inside a composite ref
    r = run(r.source, (c) => E.updateField(c, 'a.y', { name: 'yy' }));
    expect(r.source).toContain('b.(x, y, z) > a.(x, yy, z)');
  });
});

describe('index details and checks', () => {
  it('edits name, type and note, and indexes expressions', () => {
    let r = run(BASE, (c) => E.addIndex(c, 'users', { columns: ['name', '`lower(name)`'], type: 'hash', name: 'ix_name' }));
    expect(r.info.tables.users.indexes[0]).toMatchObject({ columns: ['name', '`lower(name)`'], type: 'hash', name: 'ix_name' });
    r = run(r.source, (c) => E.updateIndex(c, 'users', 0, { name: '', note: 'lookups', type: 'btree', columns: ['name'] }));
    expect(r.info.tables.users.indexes[0]).toMatchObject({ columns: ['name'], type: 'btree', note: 'lookups' });
    expect(r.info.tables.users.indexes[0].name).toBeUndefined();
  });

  it('sets a column check and table checks', () => {
    let r = run(BASE, (c) => E.updateField(c, 'posts.id', { checks: ['id > 0'] }));
    expect(r.info.fieldChecks['posts.id']).toEqual(['id > 0']);
    expect(r.source).toContain('id int [pk, check: `id > 0`]');
    r = run(r.source, (c) => E.addCheck(c, 'posts', { expression: 'user_id <> id', name: 'chk_self' }));
    expect(r.info.tables.posts.checks[0]).toMatchObject({ expression: 'user_id <> id', name: 'chk_self' });
    r = run(r.source, (c) => E.addIndex(c, 'posts', { columns: ['title'] }));
    r = run(r.source, (c) => E.addCheck(c, 'posts', { expression: 'id < 1000' }));
    expect(r.info.tables.posts.checks.map((x) => x.expression)).toEqual(['user_id <> id', 'id < 1000']);
    r = run(r.source, (c) => E.updateCheck(c, 'posts', 1, { expression: 'id < 2000', name: 'max' }));
    expect(r.info.tables.posts.checks[1]).toMatchObject({ expression: 'id < 2000', name: 'max' });
    r = run(r.source, (c) => E.deleteCheck(c, 'posts', 0));
    r = run(r.source, (c) => E.deleteCheck(c, 'posts', 0));
    expect(r.source).not.toContain('checks');
    r = run(r.source, (c) => E.updateField(c, 'posts.id', { checks: [] }));
    expect(r.info.fieldChecks['posts.id']).toBeUndefined();
  });
});

describe('table partials', () => {
  it('creates a partial, injects it, edits its columns and removes it again', () => {
    let r = run(BASE, (c) => E.addPartial(c));
    expect(r.created).toBe('partial:partial_1');
    r = run(r.source, (c) => E.updatePartial(c, 'partial_1', { name: 'timestamps', headerColor: '#16a34a', note: 'audit' }));
    expect(r.info.partials.timestamps).toMatchObject({ headerColor: '#16a34a', note: 'audit' });
    r = run(r.source, (c) => E.updateField(c, 'partial:timestamps.id', { name: 'created_at', type: 'timestamp', pk: false, increment: false }));
    r = run(r.source, (c) => E.addField(c, 'partial:timestamps'));
    r = run(r.source, (c) => E.updateField(c, 'partial:timestamps.column_1', { name: 'updated_at', type: 'timestamp' }));
    expect(r.info.partials.timestamps.fields.map((f) => f.name)).toEqual(['created_at', 'updated_at']);
    r = run(r.source, (c) => E.addPartialToTable(c, 'posts', 'timestamps'));
    expect(r.model.tables[1].fields.map((f) => f.name)).toEqual(expect.arrayContaining(['created_at', 'updated_at', 'title']));
    expect(r.info.injected['posts.created_at']).toBe('timestamps');
    expect(r.model.tables[1].headerColor).toBe('#16a34a');
    // a new column of the table goes among its own columns, not into the partial
    r = run(r.source, (c) => E.addField(c, 'posts'));
    expect(r.info.partials.timestamps.fields).toHaveLength(2);
    r = run(r.source, (c) => E.removePartialFromTable(c, 'posts', 'timestamps'));
    expect(r.model.tables[1].fields.map((f) => f.name)).not.toContain('created_at');
    r = run(r.source, (c) => E.deletePartial(c, 'timestamps'));
    expect(r.info.partials).toEqual({});
  });

  it('renaming a partial updates its injections; renaming its column updates refs', () => {
    const src = `TablePartial base {\n  id int [pk]\n}\nTable a {\n  ~base\n  name text\n}\nTable b {\n  a_id int\n}\nRef: b.a_id > a.id\n`;
    let r = run(src, (c) => E.updatePartial(c, 'base', { name: 'keyed' }));
    expect(r.source).toContain('~keyed');
    r = run(r.source, (c) => E.updateField(c, 'partial:keyed.id', { name: 'pk_id' }));
    expect(r.source).toContain('Ref: b.a_id > a.pk_id');
    r = run(r.source, (c) => E.deletePartial(c, 'keyed'));
    expect(r.model.refs).toEqual([]);
    expect(r.model.tables[0].fields.map((f) => f.name)).toEqual(['name']);
  });

  it('moves an injection among the columns, changing the column order', () => {
    const src = `TablePartial ts {\n  created_at timestamp\n}\nTable a {\n  ~ts\n  id int\n  name text\n}\n`;
    let r = run(src, (c) => E.moveInjection(c, 'a', 'ts', 1));
    expect(r.source).toContain('  id int\n  ~ts\n  name text');
    r = run(r.source, (c) => E.moveInjection(c, 'a', 'ts', 1));
    expect(r.source).toContain('  name text\n  ~ts\n');
    expect(r.model.tables[0].fields.map((f) => f.name)).toContain('created_at');
  });

  it('refuses to leave a table without columns', () => {
    const src = `TablePartial base {\n  id int [pk]\n}\nTable a {\n  ~base\n}\n`;
    expect(() => E.removePartialFromTable(ctx(src), 'a', 'base')).toThrow(E.EditError);
    expect(() => E.deletePartial(ctx(src), 'base')).toThrow(E.EditError);
  });
});

describe('records (sample data)', () => {
  it('creates, edits and deletes a records block', () => {
    let r = run(BASE, (c) => E.setRecords(c, 'users', -1, { columns: ['id', 'name'], rows: [['1', "'Alice'"], ['2', '']] }));
    expect(r.info.tables.users.records[0]).toMatchObject({ columns: ['id', 'name'], rows: [['1', 'Alice'], ['2', '']], raw: [['1', "'Alice'"], ['2', 'null']] });
    expect(r.source).toContain("Records users(id, name) {\n  1, 'Alice'\n  2, null\n}");
    r = run(r.source, (c) => E.setRecords(c, 'users', 0, { columns: ['id', 'name'], rows: [['1', "'O\\'Brien'"], ['3', 'true']] }));
    expect(r.info.tables.users.records[0].rows).toEqual([['1', "O'Brien"], ['3', 'true']]);
    r = run(r.source, (c) => E.deleteRecords(c, 'users', 0));
    expect(r.info.tables.users.records).toEqual([]);
  });

  it('follows table and column renames and column deletion', () => {
    let r = run(BASE, (c) => E.setRecords(c, 'users', -1, { columns: ['id', 'name'], rows: [['1', "'Alice'"]] }));
    r = run(r.source, (c) => E.updateTable(c, 'users', { name: 'people' }));
    expect(r.source).toContain('Records people(id, name)');
    r = run(r.source, (c) => E.updateField(c, 'people.name', { name: 'full_name' }));
    expect(r.source).toContain('Records people(id, full_name)');
    r = run(r.source, (c) => E.deleteField(c, 'people.full_name'));
    expect(r.info.tables.people.records[0]).toMatchObject({ columns: ['id'], rows: [['1']] });
    r = run(r.source, (c) => E.deleteTable(c, 'people'));
    expect(r.source).not.toContain('Records');
  });

  it('turns inline records into a Records block when edited', () => {
    const src = `Table t {\n  id int\n  v text\n  records {\n    1, 'a'\n  }\n}\n`;
    const r = run(src, (c) => E.setRecords(c, 't', 0, { columns: ['id', 'v'], rows: [['1', "'a'"], ['2', "'b'"]] }));
    expect(r.source).not.toContain('records {');
    expect(r.info.tables.t.records[0].rows).toEqual([['1', 'a'], ['2', 'b']]);
  });
});

describe('project', () => {
  it('creates, updates and deletes the Project block', () => {
    expect(ctx(BASE).info.project).toBeUndefined();
    let r = run(BASE, (c) => E.setProject(c, { name: 'shop', databaseType: 'PostgreSQL' }));
    expect(r.model.project).toMatchObject({ name: 'shop', databaseType: 'PostgreSQL' });
    expect(r.source.startsWith('Project shop {')).toBe(true);
    r = run(r.source, (c) => E.setProject(c, { note: 'online shop' }));
    expect(r.model.project).toMatchObject({ name: 'shop', databaseType: 'PostgreSQL', note: 'online shop' });
    r = run(r.source, (c) => E.deleteProject(c));
    expect(r.model.project).toBeUndefined();
    expect(r.source).toBe(BASE);
  });

  it('keeps other entries of an existing Project block', () => {
    const src = `Project p {\n  database_type: 'MySQL'\n  owner: 'data team'\n  Note: '''\n  multi\n  line'''\n}\n${BASE}`;
    const r = run(src, (c) => E.setProject(c, { databaseType: 'PostgreSQL' }));
    expect(r.model.project).toMatchObject({ name: 'p', databaseType: 'PostgreSQL' });
    expect(r.model.project?.note).toContain('multi');
    expect(r.source).toContain("owner: 'data team'");
  });
});

describe('diagram views', () => {
  const SRC = `${BASE}Table s.audit {\n  id int\n}\nTableGroup blog {\n  posts\n}\nNote memo {\n  'm'\n}\n`;

  it('reads views as @dbml/core interprets them', () => {
    const src = `${SRC}DiagramView a {\n  Tables {\n    users\n  }\n}\nDiagramView b {\n  Tables {\n    *\n  }\n  Notes {\n    memo\n  }\n}\nDiagramView c {\n  TableGroups {\n    blog\n  }\n  Schemas {\n    s\n  }\n}\nDiagramView d {\n}\n`;
    const m = ctx(src).model;
    expect(m.views.map((v) => [v.id, v.tables, v.groups, v.schemas, v.notes])).toEqual([
      ['view:a', ['users'], null, null, null],
      ['view:b', 'all', null, null, ['note:memo']],
      ['view:c', null, ['group:blog'], ['s'], null],
      ['view:d', null, null, null, null],
    ]);
    const shown = (id: string) => applyView(m, m.views.find((v) => v.id === id));
    expect(shown('view:a').tables.map((t) => t.id)).toEqual(['users']);
    expect(shown('view:a').refs).toEqual([]);
    expect(shown('view:b').tables).toHaveLength(3);
    expect(shown('view:b').notes.map((n) => n.id)).toEqual(['note:memo']);
    expect(shown('view:c').tables.map((t) => t.id).sort()).toEqual(['posts', 's.audit']);
    expect(shown('view:c').groups.map((g) => g.id)).toEqual(['group:blog']);
    expect(shown('view:d').tables).toEqual([]);
  });

  it('creates, edits and deletes views', () => {
    let r = run(SRC, (c) => E.addView(c, ['users', 'posts']));
    expect(r.created).toBe('view:view_1');
    expect(r.model.views[0]).toMatchObject({ tables: ['users', 'posts'], notes: null });
    r = run(r.source, (c) => E.updateView(c, 'view:view_1', { name: 'core', tables: ['users', 's.audit'], groups: ['group:blog'], notes: 'all' }));
    expect(r.renamed).toEqual({ 'view:view_1': 'view:core' });
    expect(r.model.views[0]).toMatchObject({ name: 'core', tables: ['users', 's.audit'], groups: ['group:blog'], notes: 'all' });
    r = run(r.source, (c) => E.updateView(c, 'view:core', { tables: 'all', groups: [], notes: [] }));
    expect(r.model.views[0]).toMatchObject({ tables: 'all', groups: null, notes: null });
    r = run(r.source, (c) => E.addView(c));
    expect(r.model.views[1]).toMatchObject({ tables: 'all', notes: 'all' });
    r = run(r.source, (c) => E.deleteView(c, 'view:core'));
    expect(r.model.views.map((v) => v.name)).toEqual(['view_1']);
  });

  it('follows renamed and deleted tables, groups and notes', () => {
    let r = run(SRC, (c) => E.addView(c, ['users', 'posts']));
    r = run(r.source, (c) => E.updateView(c, 'view:view_1', { groups: ['group:blog'], notes: ['note:memo'] }));
    r = run(r.source, (c) => E.updateTable(c, 'users', { name: 'members' }));
    expect(r.model.views[0].tables).toEqual(['members', 'posts']);
    r = run(r.source, (c) => E.updateGroup(c, 'group:blog', { name: 'content' }));
    expect(r.model.views[0].groups).toEqual(['group:content']);
    r = run(r.source, (c) => E.updateNote(c, 'note:memo', { name: 'todo' }));
    expect(r.model.views[0].notes).toEqual(['note:todo']);
    r = run(r.source, (c) => E.deleteTable(c, 'members'));
    r = run(r.source, (c) => E.deleteGroup(c, 'group:content'));
    r = run(r.source, (c) => E.deleteNote(c, 'note:todo'));
    expect(r.model.views[0]).toMatchObject({ tables: ['posts'], groups: null, notes: null });
    r = run(r.source, (c) => E.deleteTable(c, 'posts'));
    expect(r.model.views[0]).toMatchObject({ tables: null });
  });
});

describe('dependencies (Dep)', () => {
  const SRC = `Table a {\n  id int [pk]\n  x int\n}\nTable b {\n  id int [pk]\n  a_id int\n}\nTable c {\n  id int\n}\n`;
  const deps = (m: ReturnType<typeof ctx>['model']) => m.deps.map((d) => d.edges.map((e) => `${e.up.fieldIds.join('+') || e.up.tableId} -> ${e.down.fieldIds.join('+') || e.down.tableId}`).join(', '));

  it('reads block, short and inline deps', () => {
    const src = `Table a {\n  id int\n  x int\n}\nTable b [dep: <- a] {\n  id int [dep: <- a.x]\n  y int\n}\nDep d [color: #ff0000, note: 'etl'] {\n  a.id -> b.y\n  owner: 'team'\n}\nTable c {\n  id int\n}\nDep: a -> c\n`;
    const c = ctx(src);
    expect(deps(c.model)).toEqual(['a -> b', 'a.x -> b.id', 'a.id -> b.y', 'a -> c']);
    expect(c.model.deps[2]).toMatchObject({ name: 'd', color: '#ff0000', note: 'etl' });
    expect(Object.values(c.info.deps).map((d) => [d.inline, d.owner?.kind])).toEqual([[true, 'table'], [true, 'field'], [false, undefined], [false, undefined]]);
    expect(c.info.deps['dep:3'].metadata).toEqual({ owner: "'team'" });
  });

  it('adds table- and column-level deps and edits them', () => {
    let r = run(SRC, (c) => E.addDep(c, { tableId: 'a', fieldIds: [] }, { tableId: 'b', fieldIds: [] }));
    expect(r.source).toContain('Dep {\n  a -> b\n}');
    r = run(r.source, (c) => E.addDep(c, { tableId: 'a', fieldIds: ['a.x'] }, { tableId: 'b', fieldIds: ['b.a_id'] }));
    expect(deps(r.model)).toEqual(['a -> b', 'a.x -> b.a_id']);
    r = run(r.source, (c) => E.updateDep(c, c.model.deps[1].id, {
      name: 'feed', color: '#16a34a', note: 'nightly job', metadata: { owner: "'data'" },
      edges: [...c.model.deps[1].edges, { up: { tableId: 'a', fieldIds: ['a.id'] }, down: { tableId: 'b', fieldIds: ['b.id'] } }],
    }));
    expect(r.model.deps[1]).toMatchObject({ name: 'feed', color: '#16a34a', note: 'nightly job' });
    expect(deps(r.model)[1]).toBe('a.x -> b.a_id, a.id -> b.id');
    // rules: one downstream table and one level per Dep, no duplicate endpoints
    expect(() => E.updateDep(ctx(r.source), ctx(r.source).model.deps[1].id, { edges: [...ctx(r.source).model.deps[1].edges, { up: { tableId: 'b', fieldIds: [] }, down: { tableId: 'c', fieldIds: [] } }] })).toThrow(E.EditError);
    expect(() => E.addDep(ctx(r.source), { tableId: 'a', fieldIds: [] }, { tableId: 'b', fieldIds: [] })).toThrow(E.EditError);
    expect(r.info.deps[r.model.deps[1].id].metadata).toEqual({ owner: "'data'" });
    r = run(r.source, (c) => E.deleteDep(c, c.model.deps[0].id));
    expect(r.model.deps).toHaveLength(1);
  });

  it('turns an inline dep into a block when edited, removes it from its column or table', () => {
    const src = `Table a {\n  id int\n  x int\n}\nTable b [dep: <- a, headercolor: #111111] {\n  id int [pk, dep: <- a.x]\n}\n`;
    let r = run(src, (c) => E.updateDep(c, 'dep:2', { color: '#ff0000' }));
    expect(r.source).toContain('id int [pk]');
    expect(r.model.deps.find((d) => d.color)).toBeTruthy();
    r = run(r.source, (c) => E.deleteDep(c, c.model.deps.find((d) => !d.color)!.id));
    expect(r.source).toContain('Table b [headercolor: #111111] {');
  });

  it('follows renames and drops edges of deleted tables and columns', () => {
    let r = run(SRC, (c) => E.addDep(c, { tableId: 'a', fieldIds: ['a.x'] }, { tableId: 'b', fieldIds: ['b.a_id'] }));
    r = run(r.source, (c) => E.addDep(c, { tableId: 'b', fieldIds: [] }, { tableId: 'c', fieldIds: [] }));
    r = run(r.source, (c) => E.updateTable(c, 'a', { name: 'src' }));
    r = run(r.source, (c) => E.updateField(c, 'b.a_id', { name: 'src_id' }));
    expect(deps(r.model)).toEqual(['src.x -> b.src_id', 'b -> c']);
    r = run(r.source, (c) => E.deleteField(c, 'src.x'));
    expect(deps(r.model)).toEqual(['b -> c']);
    r = run(r.source, (c) => E.deleteTable(c, 'c'));
    expect(r.model.deps).toEqual([]);
  });

  it('keeps inline deps valid when the table they point at is renamed or deleted', () => {
    const src = `Table a {\n  id int\n  x int\n}\nTable b [dep: <- a] {\n  id int [dep: <- a.x]\n  y int\n}\n`;
    let r = run(src, (c) => E.updateTable(c, 'a', { name: 'src' }));
    expect(r.source).toContain('Table b [dep: <- src] {');
    expect(r.source).toContain('id int [dep: <- src.x]');
    r = run(r.source, (c) => E.deleteTable(c, 'src'));
    expect(r.model.deps).toEqual([]);
    expect(r.source).toContain('Table b {\n  id int\n');
  });
});

describe('remaining settings: inactive refs, example records, custom properties, project entries', () => {
  it('marks a ref inactive and active again', () => {
    const id = ctx(BASE).model.refs.find((x) => x.from.fieldIds[0] === 'posts.title')!.id;
    let r = run(BASE, (c) => E.updateRef(c, id, { inactive: true }));
    expect(r.source).toContain('Ref: posts.title - users.name [inactive]');
    expect(r.model.refs.find((x) => x.inactive)).toBeTruthy();
    r = run(r.source, (c) => E.updateRef(c, c.model.refs.find((x) => x.inactive)!.id, { inactive: false }));
    expect(r.model.refs.some((x) => x.inactive)).toBe(false);
  });

  it('marks sample data as example', () => {
    let r = run(BASE, (c) => E.setRecords(c, 'users', -1, { columns: ['id'], rows: [['1']], example: true }));
    expect(r.source).toContain('Records users(id) [example] {');
    expect(r.info.tables.users.records[0].example).toBe(true);
    r = run(r.source, (c) => E.setRecords(c, 'users', 0, { columns: ['id'], rows: [['2']] }));
    expect(r.info.tables.users.records[0]).toMatchObject({ example: true, rows: [['2']] });
    r = run(r.source, (c) => E.setRecords(c, 'users', 0, { columns: ['id'], rows: [['2']], example: false }));
    expect(r.info.tables.users.records[0].example).toBe(false);
  });

  it('sets custom properties of tables, columns, groups and notes, following renames and deletes', () => {
    const src = `${BASE}TableGroup g {\n  users\n}\nNote n {\n  'x'\n}\n`;
    let r = run(src, (c) => E.setMetadata(c, 'Table', 'users', { owner: 'auth team', tier: 'gold' }));
    expect(r.source).toContain("Metadata Table users {\n  owner: 'auth team'\n  tier: 'gold'\n}");
    expect(r.info.metadata['Table:users'].custom).toEqual({ owner: 'auth team', tier: 'gold' });
    r = run(r.source, (c) => E.setMetadata(c, 'Column', 'users.name', { pii: 'yes' }));
    r = run(r.source, (c) => E.setMetadata(c, 'TableGroup', 'group:g', { domain: 'identity' }));
    r = run(r.source, (c) => E.setMetadata(c, 'Note', 'note:n', { author: 'ben' }));
    expect(Object.keys(r.info.metadata).sort()).toEqual(['Column:users.name', 'Note:note:n', 'Table:users', 'TableGroup:group:g']);
    r = run(r.source, (c) => E.updateTable(c, 'users', { name: 'members' }));
    r = run(r.source, (c) => E.updateField(c, 'members.name', { name: 'full_name' }));
    r = run(r.source, (c) => E.updateGroup(c, 'group:g', { name: 'identity' }));
    r = run(r.source, (c) => E.updateNote(c, 'note:n', { name: 'memo' }));
    expect(Object.keys(r.info.metadata).sort()).toEqual(['Column:members.full_name', 'Note:note:memo', 'Table:members', 'TableGroup:group:identity']);
    r = run(r.source, (c) => E.setMetadata(c, 'Table', 'members', { owner: 'auth team' }));
    expect(r.info.metadata['Table:members'].custom).toEqual({ owner: 'auth team' });
    r = run(r.source, (c) => E.deleteField(c, 'members.full_name'));
    r = run(r.source, (c) => E.deleteGroup(c, 'group:identity'));
    r = run(r.source, (c) => E.deleteNote(c, 'note:memo'));
    r = run(r.source, (c) => E.setMetadata(c, 'Table', 'members', {}));
    expect(r.info.metadata).toEqual({});
    expect(r.source).not.toContain('Metadata');
  });

  it('keeps built-in entries of a Metadata block', () => {
    const src = `${BASE}Metadata Table users {\n  headercolor: #ff0000\n  owner: 'x'\n}\n`;
    const r = run(src, (c) => E.setMetadata(c, 'Table', 'users', { owner: 'y' }));
    expect(r.model.tables[0].headerColor).toBe('#ff0000');
    expect(r.info.metadata['Table:users']).toMatchObject({ custom: { owner: 'y' }, builtins: ['headercolor: #ff0000'] });
  });

  it('edits custom entries of the Project block', () => {
    let r = run(BASE, (c) => E.setProject(c, { name: 'shop', custom: { owner: 'data team', version: '2' } }));
    expect(r.info.projectCustom).toEqual({ owner: 'data team', version: '2' });
    r = run(r.source, (c) => E.setProject(c, { databaseType: 'MySQL' }));
    expect(r.info.projectCustom).toEqual({ owner: 'data team', version: '2' });
    r = run(r.source, (c) => E.setProject(c, { custom: { owner: 'platform' } }));
    expect(r.info.projectCustom).toEqual({ owner: 'platform' });
    expect(r.model.project).toMatchObject({ name: 'shop', databaseType: 'MySQL' });
  });
});

describe('custom properties of columns injected from a partial', () => {
  it('are written for the table that includes the partial', () => {
    const src = `TablePartial ts {\n  created_at timestamp\n}\nTable a {\n  ~ts\n  id int\n}\n`;
    let r = run(src, (c) => E.setMetadata(c, 'Column', 'a.created_at', { pii: 'no' }));
    expect(r.source).toContain("Metadata Column a.created_at {\n  pii: 'no'\n}");
    expect(r.info.metadata['Column:a.created_at'].custom).toEqual({ pii: 'no' });
    r = run(r.source, (c) => E.updateField(c, 'partial:ts.created_at', { name: 'created' }));
    expect(r.source).toContain('Metadata Column a.created {');
  });
});

describe('fixes from the independent audit', () => {
  it('editing one records cell keeps every other cell exactly as written', () => {
    const src = `Enum st {\n  a\n  b\n}\nTable t {\n  id int\n  code varchar\n  flag varchar\n  s st\n}\nRecords t(id, code, flag, s) {\n  1, '123', 'true', st.a\n  2, '', 'null', st.b\n}\n`;
    const c = ctx(src);
    const rec = c.info.tables.t.records[0];
    expect(rec.raw).toEqual([['1', "'123'", "'true'", 'st.a'], ['2', "''", "'null'", 'st.b']]);
    // the user changes one cell; the UI turns it into a literal keeping that cell's kind
    const raw = rec.raw.map((r) => [...r]);
    raw[0][0] = literalFor('10', rec.raw[0][0]);
    const r = run(src, (x) => E.setRecords(x, 't', 0, { columns: rec.columns, rows: raw }));
    expect(r.source).toContain("  10, '123', 'true', st.a\n  2, '', 'null', st.b\n");
    expect(literalFor('456', "'123'")).toBe("'456'");
    expect(literalFor('st.b', 'st.a')).toBe('st.b');
    expect(literalFor('', "'x'")).toBe('null');
  });

  it('records blocks may list only some columns, and columns can be added or removed later', () => {
    let r = run(BASE, (c) => E.setRecords(c, 'users', -1, { columns: ['name'], rows: [["'Ann'"]] }));
    expect(r.source).toContain("Records users(name) {\n  'Ann'\n}");
    r = run(r.source, (c) => E.setRecords(c, 'users', 0, { columns: ['name', 'id'], rows: [["'Ann'", '7']] }));
    expect(r.info.tables.users.records[0]).toMatchObject({ columns: ['name', 'id'], raw: [["'Ann'", '7']] });
    // DBML allows a single Records block per table
    expect(() => E.setRecords(ctx(r.source), 'users', -1, { columns: ['id'], rows: [] })).toThrow(E.EditError);
  });

  it('keeps all check constraints of a column', () => {
    const src = `Table t {\n  a int [check: \`a > 0\`, note: 'n', check: \`a < 10\`]\n}\n`;
    expect(ctx(src).info.fieldChecks['t.a']).toEqual(['a > 0', 'a < 10']);
    let r = run(src, (c) => E.updateField(c, 't.a', { notNull: true }));
    expect(r.info.fieldChecks['t.a']).toEqual(['a > 0', 'a < 10']);
    r = run(r.source, (c) => E.updateField(c, 't.a', { checks: ['a > 1', 'a < 10', 'a <> 5'] }));
    expect(r.info.fieldChecks['t.a']).toEqual(['a > 1', 'a < 10', 'a <> 5']);
  });

  it('writes defaults of an explicit kind', () => {
    const kinds = [['string', 'now()', "'now()'"], ['expression', 'now()', '`now()`'], ['number', '42', '42'], ['boolean', 'true', 'true'], ['null', '', 'null']] as const;
    for (const [kind, v, out] of kinds) {
      const r = run(BASE, (c) => E.updateField(c, 'users.name', { defaultValue: v, defaultKind: kind }));
      expect(r.source).toContain(`default: ${out}`);
    }
  });

  it('partial columns can carry an inline ref and custom settings; refs they produce are edited there', () => {
    const src = `Table users {\n  id int [pk]\n}\nTablePartial owned {\n  owner_id int\n}\nTable a {\n  ~owned\n  x int\n}\nTable b {\n  ~owned\n  y int\n}\n`;
    let r = run(src, (c) => E.updateField(c, 'partial:owned.owner_id', { ref: { op: '>', target: 'users.id' }, custom: { sensitivity: 'low' } }));
    expect(r.source).toContain("owner_id int [ref: > users.id, sensitivity: 'low']");
    expect(r.model.refs).toHaveLength(2);
    expect(r.info.fieldRef['partial:owned.owner_id']).toBe('> users.id');
    expect(r.info.fieldCustom['partial:owned.owner_id']).toEqual({ sensitivity: "'low'" });
    expect(() => E.updateRef(ctx(r.source), ctx(r.source).model.refs[0].id, { op: '-' })).toThrow(E.EditError);
    r = run(r.source, (c) => E.updateField(c, 'partial:owned.owner_id', { ref: null, custom: {} }));
    expect(r.model.refs).toHaveLength(0);
    expect(r.source).toContain('owner_id int\n');
  });

  it("lets a table's own column override one from a partial", () => {
    const src = `TablePartial ts {\n  created_at timestamp\n}\nTable a {\n  ~ts\n  made timestamptz\n}\n`;
    const r = run(src, (c) => E.updateField(c, 'a.made', { name: 'created_at' }));
    expect(r.source).toContain('  created_at timestamptz\n');
  });

  it('writes typed custom values of a dep and the sticky-note colour none', () => {
    let r = run(`Table a {\n  id int\n}\nTable b {\n  id int\n}\n`, (c) => E.addDep(c, { tableId: 'a', fieldIds: [] }, { tableId: 'b', fieldIds: [] }));
    r = run(r.source, (c) => E.updateDep(c, c.model.deps[0].id, { metadata: { freq: literalFor('5'), live: literalFor('true'), owner: literalFor('team') } }));
    expect(r.source).toContain("  freq: 5\n  live: true\n  owner: 'team'\n");
    // the kinds survive a round trip (the parser itself reports `true` and 'true' alike)
    expect(r.info.deps[r.model.deps[0].id].metadata).toEqual({ freq: '5', live: 'true', owner: "'team'" });
    const again = run(r.source, (c) => E.updateDep(c, c.model.deps[0].id, { color: '#ff0000' }));
    expect(again.source).toContain("  freq: 5\n  live: true\n  owner: 'team'\n");
    r = run(r.source, (c) => E.addNote(c, 'x'));
    r = run(r.source, (c) => E.updateNote(c, 'note:note_1', { color: 'none' }));
    expect(r.model.notes[0].color).toBe('none');
  });

  it('indexes keep any type the grammar accepts', () => {
    const r = run(BASE, (c) => E.addIndex(c, 'users', { columns: ['name'], type: 'gin' }));
    expect(r.info.tables.users.indexes[0].type).toBe('gin');
  });
});

describe('new record cells take their kind from the column type', () => {
  it('numbers, booleans, enum values and text (dates included) without any quoting', () => {
    expect(literalFor('42', undefined, { type: 'integer' })).toBe('42');
    expect(literalFor('4x', undefined, { type: 'bigint' })).toBe("'4x'");
    expect(literalFor('12.50', undefined, { type: 'decimal(10,2)' })).toBe('12.50');
    expect(literalFor('TRUE', undefined, { type: 'boolean' })).toBe('true');
    expect(literalFor('123', undefined, { type: 'varchar(20)' })).toBe("'123'");
    expect(literalFor('2024-01-31', undefined, { type: 'date' })).toBe("'2024-01-31'");
    expect(literalFor('active', undefined, { type: 'status', enumName: 'status', enumValues: ['active', 'gone'] })).toBe('status.active');
    expect(literalFor('NULL', undefined, { type: 'integer' })).toBe('null');
  });

  it('the written records parse with the intended kinds', () => {
    const src = `Enum status {\n  active\n}\nTable t {\n  n int\n  s varchar\n  b boolean\n  e status\n  d date\n}\n`;
    const cells = [literalFor('7', undefined, { type: 'int' }), literalFor('7', undefined, { type: 'varchar' }), literalFor('false', undefined, { type: 'boolean' }),
      literalFor('active', undefined, { type: 'status', enumName: 'status', enumValues: ['active'] }), literalFor('2024-01-31', undefined, { type: 'date' })];
    const r = run(src, (c) => E.setRecords(c, 't', -1, { columns: ['n', 's', 'b', 'e', 'd'], rows: [cells] }));
    expect(r.source).toContain("Records t(n, s, b, e, d) {\n  7, '7', false, status.active, '2024-01-31'\n}");
  });
});
