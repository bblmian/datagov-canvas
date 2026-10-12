import { describe, expect, it } from 'vitest';
import { Parser } from '@dbml/core';
import { toDiagramModel } from '../dbml/model';
import { buildEdges, buildNodes, handleId } from './graph';
import { autoLayout, placeNew } from './layout';
import { estimateTableSize } from './geometry';

const model = toDiagramModel(Parser.parse(`Table users {
  id int [pk]
  name varchar
}
Table posts {
  id int [pk]
  user_id int
  title varchar
}
Ref: posts.user_id > users.id
TableGroup blog {
  users
  posts
}`, 'dbmlv2').normalize() as never);

describe('autoLayout', () => {
  it('puts the referenced table left of the referencing one', () => {
    const pos = autoLayout(model, (id) => estimateTableSize(model.tables.find((t) => t.id === id)!, 'all'));
    expect(pos.users.x).toBeLessThan(pos.posts.x);
  });

  it('places new items to the right of existing ones', () => {
    const size = () => ({ width: 200, height: 100 });
    const out = placeNew(['c'], { a: { x: 0, y: 10 }, b: { x: 300, y: 50 } }, size);
    expect(out.c).toEqual({ x: 580, y: 10 });
  });
});

describe('buildNodes / buildEdges', () => {
  const positions = { users: { x: 0, y: 0 }, posts: { x: 500, y: 0 } };

  it('wraps group nodes around their tables', () => {
    const nodes = buildNodes(model, positions, 'all', []);
    const group = nodes.find((n) => n.type === 'tablegroup')!;
    expect(group.position.x).toBeLessThan(0);
    expect(group.width).toBeGreaterThan(500);
  });

  it('attaches edges to field rows on facing sides', () => {
    const edges = buildEdges(model, buildNodes(model, positions, 'all', []), 'all');
    expect(edges).toHaveLength(1);
    // posts (right) -> users (left): leave posts on its left, enter users on its right
    expect(edges[0].sourceHandle).toBe(handleId('posts.user_id', 's', 'l'));
    expect(edges[0].targetHandle).toBe(handleId('users.id', 't', 'r'));
  });

  it('falls back to table header handles when fields are hidden', () => {
    const edges = buildEdges(model, buildNodes(model, positions, 'names', []), 'names');
    expect(edges[0].sourceHandle).toBe(handleId('posts', 's', 'l'));
  });

  it('reuses unchanged nodes and edges', () => {
    const nodes = buildNodes(model, positions, 'all', []);
    const again = buildNodes(model, positions, 'all', nodes);
    expect(again.every((n, i) => n === nodes[i])).toBe(true);
    const moved = buildNodes(model, { ...positions, posts: { x: 600, y: 0 } }, 'all', nodes);
    expect(moved.find((n) => n.id === 'users')).toBe(nodes.find((n) => n.id === 'users'));
    expect(moved.find((n) => n.id === 'posts')).not.toBe(nodes.find((n) => n.id === 'posts'));

    const edges = buildEdges(model, nodes, 'all');
    expect(buildEdges(model, moved, 'all', edges)).toBe(edges);
    // posts moved to the far left: the edge switches sides, so it is rebuilt
    const flipped = buildNodes(model, { ...positions, posts: { x: -800, y: 0 } }, 'all', nodes);
    expect(buildEdges(model, flipped, 'all', edges)[0]).not.toBe(edges[0]);
  });
});
