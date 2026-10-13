// End-to-end checks of the built extension (dist/) in Chrome for Testing: every scenario builds or
// edits a schema through the canvas and inspector only, checking the DBML text after each step.
// Usage: npm run e2e [-- scenario …]   (scenarios: see e2e/scenarios; default: all)
// Branded Chrome ignores --load-extension, so this needs Chrome for Testing / Playwright's Chromium:
// set E2E_CHROME to its executable, or install it with `npx playwright-core install chromium`.
// E2E_URL instead opens the built app from a web server (e.g. `npx vite preview`), which works in
// any Chrome, including the branded one; storage then falls back to localStorage.
// HEADED=1 shows the browser window; DPR=2 emulates a Retina screen.
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const outDir = join(root, 'e2e', 'out');
mkdirSync(outDir, { recursive: true });

function findChrome() {
  if (process.env.E2E_CHROME) return process.env.E2E_CHROME;
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  const linuxCache = join(homedir(), '.cache', 'ms-playwright');
  for (const base of [cache, linuxCache]) {
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
      for (const exe of [
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        'chrome-linux/chrome',
      ]) if (existsSync(join(base, d, exe))) return join(base, d, exe);
    }
  }
  throw new Error('Chrome for Testing not found: set E2E_CHROME or run `npx playwright-core install chromium`');
}

const url = process.env.E2E_URL;
if (!url && !existsSync(join(dist, 'manifest.json'))) throw new Error('dist/ is missing: run `npm run build` first');
const all = readdirSync(join(root, 'e2e', 'scenarios')).filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4)).sort();
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : all;
const exe = findChrome();
console.log(`browser: ${exe}${url ? `\napp: ${url}` : '\napp: dist/ as an extension'}`);
let failed = 0;

for (const name of wanted) {
  // a fresh profile per scenario: each starts from the sample diagram
  const ctx = await chromium.launchPersistentContext('', {
    // English UI whatever the browser's language (the scenarios look for English labels)
    executablePath: exe, headless: !process.env.HEADED, viewport: { width: 1440, height: 860 }, deviceScaleFactor: +(process.env.DPR ?? 1), locale: 'en-US',
    args: [...(url ? [] : [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`]), ...(process.env.HEADED ? [] : ['--headless=new'])],
  });
  let appUrl = url;
  if (!appUrl) {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    appUrl = `chrome-extension://${new URL(sw.url()).host}/index.html`;
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { failed++; console.log('[pageerror]', e.message); });
  page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') console.log(`[console.${m.type()}]`, m.text().slice(0, 300)); });
  await page.goto(appUrl);
  await page.waitForSelector('.tbl', { timeout: 15000 });
  await page.waitForTimeout(800);
  const alive = async (label) => {
    const r = await Promise.race([page.evaluate(() => 1), new Promise((res) => setTimeout(() => res('TIMEOUT'), 5000))]);
    if (r === 'TIMEOUT') throw new Error(`page froze at ${label}`);
  };
  // The editing scenarios check what each control writes, not progressive disclosure: this opens
  // every collapsed inspector section as it appears (e2e/scenarios/panel.mjs covers the collapsing).
  const expandSections = () => page.evaluate(() => {
    const open = () => document.querySelectorAll('.inspector .ins-section-toggle[aria-expanded="false"]').forEach((b) => b.click());
    new MutationObserver(open).observe(document.body, { childList: true, subtree: true });
    open();
  });
  console.log(`\n=== ${name}`);
  try {
    const { default: run } = await import(join(root, 'e2e', 'scenarios', `${name}.mjs`));
    const n = await run({ page, alive, outDir, expandSections });
    failed += n;
    console.log(n ? `=== ${name}: ${n} FAILED` : `=== ${name}: passed`);
  } catch (e) {
    failed++;
    console.log(`=== ${name}: ERROR ${String(e).split('\n')[0]}`);
    await page.screenshot({ path: join(outDir, `${name}-error.png`) }).catch(() => {});
  }
  await ctx.close();
}

console.log(failed ? `\n${failed} failure(s)` : `\nall ${wanted.length} scenario(s) passed`);
process.exit(failed ? 1 : 0);
