// Renders the toolbar/store icons (public/icons/icon{16,32,48,128}.png) from the logo SVGs:
// public/logo-small.svg (thicker strokes, full-bleed) for 16/32, public/logo.svg for 48/128.
// The logo started as an AI-generated concept (ChatCut, gpt-image-2.5) and was redrawn as vector.
// Rasterized with Chrome for Testing via playwright-core, the same browser `npm run e2e` uses
// (E2E_CHROME overrides its path; `npx playwright-core install chromium` installs it).
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

function findChrome() {
  if (process.env.E2E_CHROME) return process.env.E2E_CHROME;
  for (const base of [join(homedir(), 'Library', 'Caches', 'ms-playwright'), join(homedir(), '.cache', 'ms-playwright')]) {
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
      for (const exe of [
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-linux/chrome',
      ]) if (existsSync(join(base, d, exe))) return join(base, d, exe);
    }
  }
  throw new Error('Chrome for Testing not found: set E2E_CHROME or run `npx playwright-core install chromium`');
}

const browser = await chromium.launch({ executablePath: findChrome() });
mkdirSync('public/icons', { recursive: true });
for (const [size, file] of [[16, 'logo-small.svg'], [32, 'logo-small.svg'], [48, 'logo.svg'], [128, 'logo.svg']]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const svg = readFileSync(join('public', file), 'utf8');
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block">`);
  await page.locator('img').evaluate((img) => img.decode());
  await page.screenshot({ path: `public/icons/icon${size}.png`, omitBackground: true });
  await page.close();
}
await browser.close();
console.log('icons written');
