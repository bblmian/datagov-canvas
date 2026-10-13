// Chrome Web Store screenshots (1280×800) and small promo tiles (440×280), one set per listing
// language, written to store-assets/<lang>/. Runs the built extension (dist/) in Chrome for Testing
// like e2e/run.mjs, seeds a data-governance diagram into storage, and captures each view at 2× then
// downsamples (sips) so text stays crisp at the store's exact size.
// Usage: npm run build && npm run shots   (E2E_CHROME overrides the browser path; macOS only: sips)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
if (!existsSync(join(dist, 'manifest.json'))) throw new Error('dist/ is missing: run `npm run build` first');

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

// A small warehouse: source systems → warehouse → marts, with lineage, metadata and a sticky note.
const T = {
  zh: {
    diagram: '销售数据仓库',
    project: '销售域数据仓库：源系统 → 明细层 → 集市层',
    customer: 'CRM 客户主数据', phone: '手机号（个人信息）', order: 'ERP 订单', product: '商品目录',
    dimCustomer: '客户维度（拉链表）', masked: '脱敏手机号', fact: '订单事实表', daily: '按日、品类汇总的销售额', value: '客户价值分层',
    source: '源系统', warehouse: '数据仓库明细层', mart: '数据集市',
    etl: '每日 02:00 增量同步，手机号脱敏', owner: 'CRM 团队', sensitivity: '含个人信息',
    sticky: '数据治理要点：\n1. 个人信息字段只在源系统层出现\n2. 集市层每日 06:00 前产出\n3. 指标口径变更需走评审',
    sql: `CREATE TABLE claims (\n  claim_id BIGINT PRIMARY KEY,\n  policy_no VARCHAR(30) NOT NULL,\n  amount DECIMAL(12,2),\n  reported_at TIMESTAMP\n);\n\nCREATE TABLE claim_payments (\n  payment_id BIGINT PRIMARY KEY,\n  claim_id BIGINT REFERENCES claims(claim_id),\n  paid_amount DECIMAL(12,2),\n  paid_at DATE\n);`,
    tagline: ['用 DBML 画数据治理图', 'ER 图 · 数据血缘 · 元数据'],
  },
  en: {
    diagram: 'Sales warehouse',
    project: 'Sales data warehouse: source systems → warehouse → marts',
    customer: 'CRM customer master data', phone: 'Mobile number (personal data)', order: 'ERP orders', product: 'Product catalog',
    dimCustomer: 'Customer dimension (history kept)', masked: 'Masked mobile number', fact: 'Order fact table', daily: 'Sales by day and category', value: 'Customer value segments',
    source: 'Source systems', warehouse: 'Warehouse', mart: 'Data marts',
    etl: 'Incremental load daily at 02:00; mobile numbers masked', owner: 'CRM team', sensitivity: 'Contains personal data',
    sticky: 'Governance rules:\n1. Personal data stays in the source layer\n2. Marts are ready by 06:00 daily\n3. Metric definition changes need review',
    sql: `CREATE TABLE claims (\n  claim_id BIGINT PRIMARY KEY,\n  policy_no VARCHAR(30) NOT NULL,\n  amount DECIMAL(12,2),\n  reported_at TIMESTAMP\n);\n\nCREATE TABLE claim_payments (\n  payment_id BIGINT PRIMARY KEY,\n  claim_id BIGINT REFERENCES claims(claim_id),\n  paid_amount DECIMAL(12,2),\n  paid_at DATE\n);`,
    tagline: ['Data governance diagrams from DBML', 'ER · Data lineage · Metadata'],
  },
};

const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const dbml = (t) => `Project sales_dw {
  database_type: 'PostgreSQL'
  Note: '${q(t.project)}'
}

Table ods.crm_customer [headercolor: #64748b, note: '${q(t.customer)}'] {
  customer_id bigint [pk]
  name varchar(100) [not null]
  phone varchar(20) [note: '${q(t.phone)}']
  city varchar(50)
  created_at timestamp
}

Table ods.erp_order [headercolor: #64748b, note: '${q(t.order)}'] {
  order_id bigint [pk]
  customer_id bigint [not null, ref: > ods.crm_customer.customer_id]
  product_id bigint [not null, ref: > ods.erp_product.product_id]
  amount decimal(12,2)
  status varchar(20)
  ordered_at timestamp
}

Table ods.erp_product [headercolor: #64748b, note: '${q(t.product)}'] {
  product_id bigint [pk]
  sku varchar(40) [unique]
  category varchar(40)
  price decimal(12,2)
}

Table dwd.dim_customer [headercolor: #2563eb, note: '${q(t.dimCustomer)}'] {
  customer_key bigint [pk]
  customer_id bigint [not null]
  city varchar(50)
  phone_masked varchar(20) [note: '${q(t.masked)}']
  valid_from date
  valid_to date
}

Table dwd.dim_product [headercolor: #2563eb] {
  product_key bigint [pk]
  product_id bigint [not null]
  category varchar(40)
}

Table dwd.fact_order [headercolor: #2563eb, note: '${q(t.fact)}'] {
  order_id bigint [pk]
  customer_key bigint [not null, ref: > dwd.dim_customer.customer_key]
  product_key bigint [not null, ref: > dwd.dim_product.product_key]
  order_date date
  amount decimal(12,2)
}

Table ads.sales_daily [headercolor: #16a34a, note: '${q(t.daily)}'] {
  stat_date date
  category varchar(40)
  order_cnt int
  gmv decimal(14,2)

  indexes {
    (stat_date, category) [pk]
  }
}

Table ads.customer_value [headercolor: #16a34a, note: '${q(t.value)}'] {
  customer_key bigint [pk]
  total_amount decimal(14,2)
  last_order_date date
  segment varchar(20)
}

TableGroup source_layer [color: #64748b, note: '${q(t.source)}'] {
  ods.crm_customer
  ods.erp_order
  ods.erp_product
}

TableGroup warehouse_layer [color: #2563eb, note: '${q(t.warehouse)}'] {
  dwd.dim_customer
  dwd.dim_product
  dwd.fact_order
}

TableGroup mart_layer [color: #16a34a, note: '${q(t.mart)}'] {
  ads.sales_daily
  ads.customer_value
}

Dep customer_etl [color: #0891b2, note: '${q(t.etl)}'] {
  ods.crm_customer.customer_id -> dwd.dim_customer.customer_id
  ods.crm_customer.phone -> dwd.dim_customer.phone_masked
}

Dep: ods.erp_product -> dwd.dim_product
Dep: ods.erp_order -> dwd.fact_order
Dep: dwd.fact_order -> ads.sales_daily
Dep: dwd.dim_product -> ads.sales_daily
Dep: dwd.fact_order -> ads.customer_value
Dep: dwd.dim_customer -> ads.customer_value

Metadata Table ods.crm_customer {
  owner: '${q(t.owner)}'
  sensitivity: '${q(t.sensitivity)}'
}

Note governance_rules [headercolor: #f59e0b] {
  '''${t.sticky}'''
}
`;

// Left to right: source systems, warehouse, marts (ids as in DiagramModel: schema.table, note:<name>)
const POSITIONS = {
  'ods.crm_customer': { x: 0, y: 0 },
  'ods.erp_order': { x: 0, y: 230 },
  'ods.erp_product': { x: 0, y: 480 },
  'dwd.dim_customer': { x: 420, y: 0 },
  'dwd.fact_order': { x: 420, y: 250 },
  'dwd.dim_product': { x: 420, y: 470 },
  'ads.sales_daily': { x: 840, y: 120 },
  'ads.customer_value': { x: 840, y: 330 },
  'note:governance_rules': { x: 840, y: 520 },
};

// 2× capture → exact store size
const shrink = (file, w, h) => execFileSync('sips', ['-z', String(h), String(w), file], { stdio: 'ignore' });

const exe = findChrome();
for (const lang of ['zh', 'en']) {
  const t = T[lang];
  const out = join(root, 'store-assets', lang);
  mkdirSync(out, { recursive: true });
  const ctx = await chromium.launchPersistentContext('', {
    executablePath: exe, headless: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2,
    locale: lang === 'zh' ? 'zh-CN' : 'en-US',
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--headless=new'],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 });
  const appUrl = `chrome-extension://${new URL(sw.url()).host}/index.html`;
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(appUrl);
  await page.waitForSelector('.tbl', { timeout: 15000 });

  const seed = async (settings) => {
    await page.evaluate(async ({ doc, settings }) => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({
        'dd:index': [{ id: doc.id, name: doc.name, updatedAt: doc.updatedAt }],
        [`dd:doc:${doc.id}`]: doc,
        'dd:settings': settings,
      });
    }, { doc: { id: 'demo', name: t.diagram, updatedAt: Date.now(), source: dbml(t), positions: POSITIONS }, settings: { lang, currentId: 'demo', ...settings } });
    await page.reload();
    await page.waitForSelector('.tbl', { timeout: 15000 });
    await page.waitForTimeout(1500);
    if (await page.locator('.stale, .banner-error').count()) throw new Error(`${lang}: the sample DBML has errors`);
  };
  const shot = async (name) => {
    const file = join(out, name);
    await page.mouse.move(1279, 799); // no hover highlight unless a step asks for one
    await page.waitForTimeout(400);
    await page.screenshot({ path: file });
    shrink(file, 1280, 800);
    console.log(file);
  };
  const table = (name) => page.locator('.tbl', { has: page.locator('.tbl-name', { hasText: name }) });

  // 1. editor and diagram side by side
  await seed({ editorWidth: 420, displayMode: 'all' });
  await shot('1-editor-and-diagram.png');

  // 2. lineage across the three layers, editor collapsed, key columns only
  await seed({ editorHidden: true, displayMode: 'keys' });
  await shot('2-lineage.png');

  // 3. property panel on the fact table
  await seed({ editorHidden: true, displayMode: 'all', inspectorWidth: 420 });
  await table('dwd.fact_order').locator('.tbl-head').dblclick();
  await page.waitForSelector('.inspector .ins-field');
  await shot('3-property-panel.png');

  // 4. importing existing SQL
  await seed({ editorWidth: 420, displayMode: 'all' });
  await page.locator('header .btn', { hasText: lang === 'zh' ? '导入' : 'Import' }).click();
  await page.locator('textarea').last().fill(t.sql);
  await shot('4-import-sql.png');
  await ctx.close();

  // small promo tile: logo, name, tagline
  const tile = await chromium.launch({ executablePath: exe, headless: true });
  const tp = await tile.newPage({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 2 });
  const logo = readFileSync(join(root, 'public', 'logo.svg'), 'utf8');
  const name = lang === 'zh' ? '数据治理画图' : 'DataGov Canvas';
  await tp.setContent(`<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;width:440px;height:280px;background:#0f172a;color:#fff;font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif}
    .w{display:flex;flex-direction:column;justify-content:center;gap:14px;height:100%;padding:0 40px;box-sizing:border-box}
    .top{display:flex;align-items:center;gap:16px} svg{width:72px;height:72px}
    h1{margin:0;font-size:${lang === 'zh' ? 34 : 32}px;font-weight:700;letter-spacing:.5px}
    p{margin:0;font-size:17px;line-height:1.5;color:#cbd5e1} p b{color:#22d3ee;font-weight:600}
  </style><div class="w"><div class="top">${logo}<h1>${name}</h1></div><p>${t.tagline[0]}<br><b>${t.tagline[1]}</b></p></div>`);
  const tileFile = join(out, 'promo-small-440x280.png');
  await tp.screenshot({ path: tileFile });
  shrink(tileFile, 440, 280);
  console.log(tileFile);
  await tile.close();
}
