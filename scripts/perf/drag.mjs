// Drag-focused benchmark. Usage: node drag.mjs <distDir> <label>
// env: N (tables, default 60), CPU (throttle), DPR (default 2), PROFILE=<scenario>, TRACE=<scenario>
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { bigDbml } from './gen.mjs';

const [,, distDir, label = 'drag'] = process.argv;
const N = +(process.env.N ?? 60);
const exe = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const ctx = await chromium.launchPersistentContext('', {
  executablePath: exe, headless: true, viewport: { width: 1440, height: 860 }, deviceScaleFactor: +(process.env.DPR ?? 2), locale: 'en-US',
  args: [`--disable-extensions-except=${distDir}`, `--load-extension=${distDir}`, '--headless=new'],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
await page.addInitScript(() => {
  const w = window;
  w.__perf = { long: [], frames: [], rec: false };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (w.__perf.rec) w.__perf.long.push({ t: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true });
  let last = 0;
  const loop = (ts) => { if (w.__perf.rec) { if (last) w.__perf.frames.push(ts - last); last = ts; } else last = 0; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
});
await page.goto(`chrome-extension://${new URL(sw.url()).host}/index.html`);
await page.waitForSelector('.tbl', { timeout: 30000 });
await page.waitForTimeout(800);
if (process.env.CSS) await page.addStyleTag({ content: process.env.CSS });
await page.locator('.cm-content').click();
await page.keyboard.press('Meta+A');
await page.keyboard.insertText(bigDbml(N));
for (let end = Date.now() + 30000; (await page.locator('.tbl').count()) < N;) { if (Date.now() > end) throw new Error('tables not rendered'); await page.waitForTimeout(50); }
await page.waitForTimeout(1500);
// collapse the editor so the canvas is wide, close nothing else
const throttle = +(process.env.CPU ?? 1);
if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });

const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
const results = { label, N, cpu: throttle, edges: await page.locator('.react-flow__edge').count() };

async function measure(name, fn) {
  await page.mouse.move(5, 845);
  await page.waitForTimeout(400);
  await page.evaluate(() => { const p = window.__perf; p.long = []; p.frames = []; p.rec = true; });
  const m0 = await metrics();
  const prof = process.env.PROFILE === name;
  const trace = process.env.TRACE === name;
  let traceDone;
  if (trace) {
    const chunks = [];
    cdp.on('Tracing.dataCollected', (e) => chunks.push(...e.value));
    traceDone = new Promise((r) => cdp.once('Tracing.tracingComplete', () => r(chunks)));
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink,cc,gpu,viz', transferMode: 'ReportEvents' });
  }
  if (prof) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start'); }
  const extra = (await fn()) ?? {};
  if (prof) fs.writeFileSync(`${label}-${name}.cpuprofile`, JSON.stringify((await cdp.send('Profiler.stop')).profile));
  if (trace) { await cdp.send('Tracing.end'); fs.writeFileSync(`${label}-${name}.trace.json`, JSON.stringify(await traceDone)); }
  const m1 = await metrics();
  const p = await page.evaluate(() => { const p = window.__perf; p.rec = false; return p; });
  const d = (k) => Math.round((m1[k] - m0[k]) * 1000);
  const f = p.frames;
  const r = {
    frames: f.length, p50: +pct(f, 0.5).toFixed(1), p95: +pct(f, 0.95).toFixed(1), max: +Math.max(0, ...f).toFixed(1),
    janky: f.filter((x) => x > 17).length, slowAt: f.map((x, i) => (x > 30 ? `${i}:${Math.round(x)}` : null)).filter(Boolean).slice(0, 8).join(' '),
    scriptMs: d('ScriptDuration'), layoutMs: d('LayoutDuration'), styleMs: d('RecalcStyleDuration'), taskMs: d('TaskDuration'),
    longTasks: p.long.length, longMax: Math.round(Math.max(0, ...p.long.map((x) => x.d))),
    ...extra,
  };
  console.log(name.padEnd(18), JSON.stringify(r));
  results[name] = r;
}

const moves = 90;
async function dragFrom(x, y, { dx = 3, dy = 2 } = {}) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= moves; i++) { await page.mouse.move(x + i * dx, y + i * dy); await page.waitForTimeout(8); }
  const tUp = await page.evaluate(() => performance.now());
  await page.mouse.up();
  // release cost: long tasks after the mouse-up
  await page.waitForTimeout(900);
  const after = await page.evaluate((t) => window.__perf.long.filter((l) => l.t >= t - 5), tUp);
  return { releaseLongMs: Math.round(after.reduce((a, l) => a + l.d, 0)) };
}
// table headers fully inside the canvas, nearest its centre first
async function visibleTables() {
  return page.evaluate(() => {
    const c = document.querySelector('.react-flow').getBoundingClientRect();
    const cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    return [...document.querySelectorAll('.react-flow__node-table')].map((n) => {
      const h = n.querySelector('.tbl-head').getBoundingClientRect();
      return { id: n.dataset.id, x: h.x, y: h.y, w: h.width, h: h.height, d: Math.hypot(h.x + h.width / 2 - cx, h.y - cy) };
    }).filter((b) => b.x > c.left + 20 && b.x + b.w < c.right - 300 && b.y > c.top + 70 && b.y < c.bottom - 200).sort((a, b) => a.d - b.d);
  });
}
// pan the canvas (dragging an empty spot) so that table t10 sits left of the centre
async function bringIntoView() {
  const r = await page.evaluate(() => {
    const c = document.querySelector('.react-flow').getBoundingClientRect();
    const h = document.querySelector('.react-flow__node[data-id="t10"] .tbl-head').getBoundingClientRect();
    let pt = null;
    for (let y = c.top + 60; y < c.bottom - 70 && !pt; y += 10) for (let x = c.left + 10; x < c.right - 10; x += 10) {
      if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) { pt = { x, y }; break; }
    }
    return { pt, dx: c.left + c.width * 0.35 - h.x, dy: c.top + 160 - h.y };
  });
  if (!r.pt) throw new Error('no empty pane spot');
  await page.mouse.move(r.pt.x, r.pt.y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(r.pt.x + (r.dx * i) / 10, r.pt.y + (r.dy * i) / 10);
  await page.mouse.up(); await page.waitForTimeout(400);
}
const nodePos = (id) => page.evaluate((id) => document.querySelector(`.react-flow__node[data-id="${id}"]`)?.style.transform, id);
const headOf = async (name) => page.locator('.tbl', { has: page.locator('.tbl-name', { hasText: new RegExp(`^${name}$`) }) }).locator('.tbl-head').boundingBox();

async function suite(tag) {
  // single table near the centre
  await measure(`${tag}-table`, async () => {
    const [b] = await visibleTables();
    if (!b) return { skipped: true };
    const before = await nodePos(b.id);
    const r = await dragFrom(b.x + 30, b.y + b.h / 2);
    return { ...r, moved: before !== (await nodePos(b.id)) };
  });
  // a table group (moves its members)
  await measure(`${tag}-group`, async () => {
    const id = await page.evaluate(() => {
      const c = document.querySelector('.react-flow').getBoundingClientRect();
      const g = [...document.querySelectorAll('.react-flow__node-tablegroup')].find((n) => { const r = n.getBoundingClientRect(); return r.x > c.left + 10 && r.y > c.top + 70 && r.x < c.right - 300 && r.y < c.bottom - 300; });
      return g?.dataset.id;
    });
    if (!id) return { skipped: true };
    const g = await page.locator(`.react-flow__node[data-id="${id}"] .grp-head`).boundingBox();
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className, [g.x + 15, g.y + g.height / 2]);
    const before = await nodePos(id);
    const r = await dragFrom(g.x + 15, g.y + g.height / 2, { dx: 2, dy: 1 });
    r.hit = String(hit).slice(0, 40);
    return { ...r, moved: before !== (await nodePos(id)) };
  });
  // up to ten selected tables at once
  await measure(`${tag}-multi`, async () => {
    const vis = (await visibleTables()).slice(0, 10);
    if (!vis.length) return { skipped: true };
    await page.keyboard.down('Meta');
    for (const b of vis) await page.mouse.click(b.x + 30, b.y + b.h / 2);
    await page.keyboard.up('Meta');
    const sel = await page.locator('.react-flow__node-table.selected').count();
    const b = vis[0];
    const before = await nodePos(b.id);
    const r = await dragFrom(b.x + 30, b.y + b.h / 2, { dx: -2, dy: 1 });
    return { ...r, selected: sel, moved: before !== (await nodePos(b.id)) };
  });
  // deselect: click an empty spot of the pane
  const pt = await page.evaluate(() => {
    const c = document.querySelector('.react-flow').getBoundingClientRect();
    for (let y = c.top + 80; y < c.bottom - 80; y += 20) for (let x = c.left + 20; x < c.right - 20; x += 20) {
      if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y };
    }
    return null;
  });
  if (pt) await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(300);
}

const scale = () => page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a);
async function zoomTo(target) {
  await page.mouse.move(930, 450);
  for (let i = 0; i < 60; i++) {
    const k = await scale();
    if (Math.abs(Math.log(k / target)) < 0.08) break;
    await page.mouse.wheel(0, k < target ? -40 : 40); await page.waitForTimeout(40);
  }
  await page.waitForTimeout(500);
  return +(await scale()).toFixed(2);
}
await page.locator('.toolbar:not(.edit-tools) button').nth(2).click(); await page.waitForTimeout(700);
results.zoomFit = +(await scale()).toFixed(2);
await suite('fit');
results.zoomOverview = await zoomTo(+(process.env.Z1 ?? 0.45));
await bringIntoView();
await page.screenshot({ path: `${label}-overview.png` });
console.log('scale', results.zoomOverview, 'visible', (await visibleTables()).length);
await suite('overview');
results.zoom100 = await zoomTo(1);
await bringIntoView();
await suite('z100');

fs.writeFileSync(`${label}.json`, JSON.stringify(results, null, 2));
await ctx.close();
