// main-thread work while idle for 3 s with the mouse resting on a table (its edges highlighted)
import { chromium } from 'playwright-core';
const exe = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const dist = process.argv[2];
const ctx = await chromium.launchPersistentContext('', { executablePath: exe, headless: true, viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--headless=new'] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const page = await ctx.newPage();
await page.goto(`chrome-extension://${new URL(sw.url()).host}/index.html`);
await page.waitForSelector('.tbl'); await page.waitForTimeout(1500);
if (process.env.CSS) await page.addStyleTag({ content: process.env.CSS });
const cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable');
const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
for (const where of ['pane', 'table']) {
  if (where === 'table') { const b = await page.locator('.tbl-head').first().boundingBox(); await page.mouse.move(b.x + 30, b.y + 10); }
  else await page.mouse.move(5, 845);
  await page.waitForTimeout(500);
  const a = await m(); await page.waitForTimeout(3000); const b = await m();
  console.log(where.padEnd(6), 'task ms / 3 s:', Math.round((b.TaskDuration - a.TaskDuration) * 1000), ' frames:', b.FrameCount !== undefined ? b.FrameCount - a.FrameCount : '?');
}
await ctx.close();
