import fs from 'node:fs';
const ev = JSON.parse(fs.readFileSync(process.argv[2]));
// main renderer thread: the one with most RunTask / FunctionCall
const byThread = new Map();
for (const e of ev) if (e.ph === 'X' && e.dur) { const k = `${e.pid}:${e.tid}`; byThread.set(k, (byThread.get(k) ?? 0) + (e.name === 'FunctionCall' ? e.dur : 0)); }
const main = [...byThread].sort((a, b) => b[1] - a[1])[0][0];
const sum = new Map();
const threadTotals = new Map();
for (const e of ev) {
  if (e.ph !== 'X' || !e.dur) continue;
  const k = `${e.pid}:${e.tid}`;
  if (e.name === 'ThreadControllerImpl::RunTask' || e.name === 'RunTask') threadTotals.set(k, (threadTotals.get(k) ?? 0) + e.dur);
  if (k !== main) continue;
  sum.set(e.name, (sum.get(e.name) ?? 0) + e.dur);
}
console.log('main thread', main);
console.log([...sum].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([n, d]) => `${(d / 1000).toFixed(0).padStart(7)}ms ${n}`).join('\n'));
const names = new Map(ev.filter((e) => e.name === 'thread_name').map((e) => [`${e.pid}:${e.tid}`, e.args.name]));
console.log('--- RunTask by thread');
console.log([...threadTotals].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, d]) => `${(d / 1000).toFixed(0).padStart(7)}ms ${names.get(k) ?? k}`).join('\n'));
