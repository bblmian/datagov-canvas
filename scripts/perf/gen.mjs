// Generates a large-ish DBML document: N tables, ~10 fields each, FKs to earlier tables, a few groups.
export function bigDbml(n = 60) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(`Table t${i} [note: 'table ${i}'] {`);
    out.push(`  id integer [pk, increment]`);
    const refs = i === 0 ? [] : [Math.floor(i / 2), Math.max(0, i - 3)].filter((v, k, a) => a.indexOf(v) === k && v !== i);
    refs.forEach((r) => out.push(`  t${r}_id integer [not null, ref: > t${r}.id]`));
    for (let f = 0; f < 8; f++) out.push(`  col_${f}_name varchar(255) [note: 'column ${f}']`);
    out.push(`  created_at timestamp [default: \`now()\`]`);
    out.push('}\n');
  }
  for (let g = 0; g < 4; g++) {
    out.push(`TableGroup g${g} {`);
    for (let i = g * 5; i < g * 5 + 4; i++) out.push(`  t${i}`);
    out.push('}\n');
  }
  return out.join('\n');
}
