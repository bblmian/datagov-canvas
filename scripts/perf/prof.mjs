import fs from 'node:fs';
const p = JSON.parse(fs.readFileSync(process.argv[2]));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const dt = p.timeDeltas; const self = new Map(); const total = new Map();
const key = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
p.samples.forEach((id, i) => {
  const d = (dt[i + 1] ?? 0) / 1000;
  const n = byId.get(id); const k = key(n);
  self.set(k, (self.get(k) ?? 0) + d);
  const seen = new Set(); let cur = id;
  while (cur !== undefined) { const kk = key(byId.get(cur)); if (!seen.has(kk)) { seen.add(kk); total.set(kk, (total.get(kk) ?? 0) + d); } cur = parent.get(cur); }
});
const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0).padStart(6)}ms  ${k}`).join('\n');
console.log('--- self'); console.log(top(self, 25));
console.log('--- total (inclusive)'); console.log(top(total, 45));
