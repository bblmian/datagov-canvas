import { describe, expect, it } from 'vitest';
import { Parser, exporter, importer } from '@dbml/core';
import { reuseUnchanged, toDiagramModel, toDiagnostics } from './model';
import { sampleDbml } from './sample';
import { locateDeclaration } from './locate';

const parse = (src: string) => toDiagramModel(Parser.parse(src, 'dbmlv2').normalize() as never);

describe('toDiagramModel', () => {
  it('maps tables, fields and settings', () => {
    const m = parse(`Table users as U [headercolor: #3498DB, note: 'people'] {
  id integer [pk, increment]
  name varchar(255) [not null, unique, default: 'x', note: 'full name']
}`);
    expect(m.tables).toHaveLength(1);
    const t = m.tables[0];
    expect(t).toMatchObject({ id: 'users', name: 'users', alias: 'U', note: 'people', headerColor: '#3498DB' });
    expect(t.fields[0]).toMatchObject({ id: 'users.id', pk: true, increment: true, isRef: false });
    expect(t.fields[1]).toMatchObject({ type: 'varchar(255)', notNull: true, unique: true, defaultValue: "'x'", note: 'full name' });
  });

  it('marks composite primary key columns as pk', () => {
    const m = parse(`Table f {
  a int [pk]
  b int [pk]
  c int
}`);
    expect(m.tables[0].fields.map((f) => f.pk)).toEqual([true, true, false]);
  });

  it('maps refs with relations and qualified schema tables', () => {
    const m = parse(`Table a {
  id int [pk]
  b_id int
}
Table s.b {
  id int [pk]
}
Ref: a.b_id > s.b.id
Ref: a.id - s.b.id`);
    expect(m.tables.map((t) => t.id)).toEqual(['a', 's.b']);
    expect(m.refs[0]).toMatchObject({
      from: { tableId: 'a', fieldIds: ['a.b_id'], relation: '*' },
      to: { tableId: 's.b', fieldIds: ['s.b.id'], relation: '1' },
    });
    expect(m.refs[1].from.relation).toBe('1');
    expect(m.tables[0].fields.find((f) => f.name === 'b_id')!.isRef).toBe(true);
  });

  it('maps enums, groups and sticky notes', () => {
    const m = parse(`Enum status {
  on [note: 'enabled']
  off
}
Table t {
  s status
}
TableGroup g [color: #ff0000] {
  t
}
Note n {
  'hello'
}`);
    expect(m.enums[0]).toEqual({ id: 'status', name: 'status', values: [{ name: 'on', note: 'enabled' }, { name: 'off', note: undefined }] });
    expect(m.tables[0].fields[0].enumId).toBe('status');
    expect(m.tables[0].groupId).toBe('group:g');
    expect(m.groups[0]).toMatchObject({ id: 'group:g', color: '#ff0000', tableIds: ['t'] });
    expect(m.notes[0]).toMatchObject({ id: 'note:n', content: 'hello' });
  });

  it('parses both sample documents', () => {
    for (const lang of ['en', 'zh'] as const) {
      const m = parse(sampleDbml(lang));
      expect(m.tables.map((t) => t.id)).toEqual(['users', 'posts', 'follows']);
      expect(m.refs).toHaveLength(3);
      expect(m.notes).toHaveLength(1);
    }
  });
});

describe('reuseUnchanged', () => {
  const parse = (src: string) => toDiagramModel(Parser.parse(src, 'dbmlv2').normalize() as never);
  const src = `Table a {\n  id int [pk]\n}\nTable b {\n  id int [pk]\n  a_id int [ref: > a.id]\n}\n`;

  it('returns the previous model when nothing changed', () => {
    const prev = parse(src);
    expect(reuseUnchanged(prev, parse(`// comment\n${src}`))).toBe(prev);
  });

  it('keeps unchanged tables and refs, replaces changed ones', () => {
    const prev = parse(src);
    const next = reuseUnchanged(prev, parse(src.replace('Table a {\n  id int [pk]', 'Table a {\n  id int [pk]\n  name text')));
    expect(next).not.toBe(prev);
    expect(next.tables.find((t) => t.id === 'b')).toBe(prev.tables.find((t) => t.id === 'b'));
    expect(next.tables.find((t) => t.id === 'a')).not.toBe(prev.tables.find((t) => t.id === 'a'));
    expect(next.tables.find((t) => t.id === 'a')!.fields.map((f) => f.name)).toEqual(['id', 'name']);
    expect(next.refs).toBe(prev.refs);
  });
});

describe('toDiagnostics', () => {
  it('reports 1-based locations from compiler errors', () => {
    let err: unknown;
    try {
      Parser.parse('Table x {\n  id int [pk\n}', 'dbmlv2');
    } catch (e) {
      err = e;
    }
    const d = toDiagnostics(err);
    expect(d.length).toBeGreaterThan(0);
    expect(d[0].line).toBeGreaterThanOrEqual(2);
    expect(d[0].severity).toBe('error');
  });
});

describe('export / import round trip', () => {
  it('exports SQL and imports it back', () => {
    const sql = exporter.export(sampleDbml('en'), 'postgres');
    expect(sql).toContain('CREATE TABLE "users"');
    const dbml = importer.import(sql, 'postgres');
    expect(parse(dbml).tables.map((t) => t.name).sort()).toEqual(['follows', 'posts', 'users']);
  });
});

describe('locateDeclaration', () => {
  const src = `Table users {\n  id int\n}\n  Table "order items" {\n  id int\n}\nTable s.users {\n  id int\n}\nNote tips {\n  'x'\n}`;
  it('finds plain, quoted and schema-qualified tables', () => {
    expect(locateDeclaration(src, 'Table', 'users')).toBe(0);
    expect(src.slice(locateDeclaration(src, 'Table', 'order items')).startsWith('Table "order items"')).toBe(true);
    expect(src.slice(locateDeclaration(src, 'Table', 'users', 's')).startsWith('Table s.users')).toBe(true);
    expect(src.slice(locateDeclaration(src, 'Note', 'tips')).startsWith('Note tips')).toBe(true);
    expect(locateDeclaration(src, 'Table', 'missing')).toBe(-1);
  });
});
