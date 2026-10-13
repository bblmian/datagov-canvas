// The findings of an independent audit of "everything DBML can express is doable graphically",
// each exercised through the inspector and checked against the DBML text.
const SEED = `Enum st {
  a
  b
  c
}

Table users {
  id int [pk]
  qty int [check: \`qty > 0\`, check: \`qty < 100\`]
  code varchar
  s st
  made timestamptz
  Indexes {
    code [type: gin]
  }
}

Records users(id, code, s) {
  1, '123', st.a
  2, 'true', st.b
}

TablePartial audit {
  made timestamp
  owner_id int
}

Table docs {
  ~audit
  id int [pk]
}

Table logs {
  ~audit
  id int [pk]
}

Note memo {
  'hello'
}

Table a {
  id int
}

Table b {
  id int
}

Dep d {
  a -> b
}
`;

export default async function ({ page, alive, outDir, expandSections }) {
  await expandSections();
  let failures = 0;
  const dbml = () => page.evaluate(() => [...document.querySelectorAll('.cm-line')].map((l) => l.textContent).join('\n'));
  const settle = () => page.waitForTimeout(300);
  const step = async (label, action, ok) => {
    try {
      await action(); await settle();
      const src = await dbml();
      const pass = !!ok(src);
      if (!pass) failures++;
      console.log(pass ? 'PASS' : 'FAIL', label, pass ? '' : `\n${src}`);
    } catch (e) {
      failures++;
      console.log('FAIL', label, String(e).split('\n')[0]);
      await page.screenshot({ path: `${outDir}/audit-fixes-fail.png` });
    }
  };
  const commit = async (text) => { await page.keyboard.press('Meta+A'); await page.keyboard.type(text); await page.keyboard.press('Enter'); await settle(); };
  const ins = page.locator('.inspector');
  const section = (title) => ins.locator('.ins-section', { has: page.locator('.ins-section-head', { hasText: new RegExp(`^${title}`) }) });
  const field = (name) => ins.locator('.ins-field', { has: page.locator(`.f-name[value="${name}"]`) });
  const more = async (name) => { if (!(await field(name).locator('.ins-field-more').count())) await field(name).locator('button[title="Default value and note"]').click(); };
  const tableHead = (name) => page.locator('.tbl', { has: page.locator('.tbl-name', { hasText: new RegExp(`^${name}$`) }) }).locator('.tbl-head');
  const openTable = async (name) => { await tableHead(name).dblclick(); await page.waitForSelector('.inspector .ins-field'); await settle(); };
  const grid = () => section('Sample data').locator('.ins-records').first();

  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText(SEED);
  await page.waitForTimeout(1200);
  await page.locator('.toolbar:not(.edit-tools) button').nth(2).click();
  await page.waitForTimeout(400);
  await openTable('users');

  await step('editing one records cell keeps the others exactly (text that looks like a number/boolean, enum values)', async () => {
    await grid().locator('tbody tr').first().locator('td').first().locator('input').click(); await commit('10');
  }, (s) => s.includes("Records users(id, code, s) {\n  10, '123', st.a\n  2, 'true', st.b\n}"));

  await step('a records cell keeps its kind when edited', async () => {
    await grid().locator('tbody tr').first().locator('td').nth(1).locator('input').click(); await commit('456');
  }, (s) => s.includes("  10, '456', st.a\n"));

  await step('records: remove a column from the block, then add another', async () => {
    await grid().locator('thead th', { hasText: 'code' }).locator('button').click(); await settle();
    await grid().locator('thead select').selectOption('qty');
  }, (s) => s.includes('Records users(id, s, qty) {\n  10, st.a, null\n  2, st.b, null\n}'));

  await step('new cells typed plainly get their kind from the column type (number, enum value)', async () => {
    await grid().locator('button.link', { hasText: 'Row' }).click(); await settle();
    const last = grid().locator('tbody tr').last();
    await last.locator('td').nth(0).locator('input').click(); await commit('3');
    await last.locator('td').nth(1).locator('input').click(); await commit('c');
    await last.locator('td').nth(2).locator('input').click(); await commit('5');
  }, (s) => s.includes('  3, st.c, 5\n}'));

  await step('records: one block per table — no second "+ Sample data" once there is one', async () => {
    if (await section('Sample data').locator('.ins-section-head button.link').count()) throw new Error('add button still offered');
  }, () => true);

  await step('records: a new block with only some columns', async () => {
    await openTable('docs');
    await section('Sample data').locator('.ins-section-head button.link').click();
    const form = section('Sample data').locator('.ins-index-form');
    for (const n of ['made', 'owner_id']) await form.locator('label', { hasText: new RegExp(`^ ?${n}$`) }).click();
    await form.locator('.btn.primary').click(); await settle();
    await openTable('users');
  }, (s) => s.includes('Records docs(id) {\n  null\n}'));

  await step('a third check on a column keeps the other two', async () => {
    await more('qty');
    const add = field('qty').locator('.ins-row', { hasText: 'Check' }).locator('.ins-check').last().locator('input');
    await add.fill('qty <> 50'); await add.press('Enter');
  }, (s) => s.includes('qty int [check: `qty > 0`, check: `qty < 100`, check: `qty <> 50`]'));

  await step('an index type outside btree/hash is shown and can be changed', async () => {
    const ix = section('Indexes');
    await ix.locator('button[title="Columns, name, type and note"]').click();
    const type = ix.locator('.ins-row', { hasText: 'Type' }).locator('input');
    if ((await type.inputValue()) !== 'gin') throw new Error('gin not shown');
    await type.click(); await commit('gist');
  }, (s) => s.includes('code [type: gist]'));

  await step('multi-line column note', async () => {
    await more('code');
    const note = field('code').locator('.ins-row', { hasText: 'Note' }).locator('textarea');
    await note.click(); await page.keyboard.type('line one'); await page.keyboard.press('Enter'); await page.keyboard.type('line two');
    await field('code').locator('.f-name').click();
  }, (s) => s.includes("code varchar [note: '''line one\nline two''']"));

  await step('default value of an explicit kind (expression)', async () => {
    await more('made');
    const row = field('made').locator('.ins-row', { hasText: 'Default' });
    await row.locator('input').click(); await commit('now()');
    await row.locator('select').selectOption('expression');
  }, (s) => s.includes('made timestamptz [default: `now()`]'));

  await step('enum value reordered', async () => {
    await page.locator('.edit-tools button', { hasText: 'Enums' }).click(); await settle();
    await ins.locator('.ins-enum-value').first().locator('button[title="Move down"]').click();
  }, (s) => s.includes('Enum st {\n  b\n  a\n  c\n}'));

  await step('inline ref and custom setting on a partial column (every including table gets the ref)', async () => {
    await page.locator('.edit-tools button', { hasText: 'Partials' }).click(); await settle();
    const f = ins.locator('.ins-enum').first().locator('.ins-field', { has: page.locator('.f-name[value="owner_id"]') });
    await f.locator('button[title="Default value and note"]').click();
    const ref = f.locator('.ins-row', { hasText: 'References' });
    await ref.locator('select').first().selectOption('>'); await settle();
    await ref.locator('select').nth(1).selectOption('users.id'); await settle();
    const props = f.locator('.ins-row', { hasText: 'Custom properties' }).locator('.ins-check').last();
    await props.locator('input').first().fill('sensitivity'); await props.locator('input').nth(1).fill('low'); await props.locator('button').click();
  }, (s) => s.includes("owner_id int [ref: > users.id, sensitivity: 'low']"));

  await step('a ref produced by a partial explains where to edit it', async () => {
    await openTable('docs');
    await section('Relationships').locator('.ins-link-row').first().click(); await settle();
    if (!(await ins.textContent()).includes('comes from a column of the partial')) throw new Error('no hint');
  }, () => true);

  await step("a table's own column overrides one from a partial", async () => {
    await openTable('users');
    await field('made').locator('.f-name').click(); await commit('owner_id');
  }, (s) => s.includes('  owner_id timestamptz [default: `now()`]'));

  await step('sticky note colour none', async () => {
    // close the panel first: the note sits at the canvas edge, half under the docked inspector
    await ins.locator('.ins-head .icon-btn').click(); await settle();
    await page.locator('.sticky-head', { hasText: 'memo' }).dblclick(); await page.waitForSelector('.inspector textarea'); await settle();
    await ins.locator('.swatch.clear').click();
  }, (s) => s.includes('Note memo [color: none] {'));

  await step('dependency custom values keep their kind (number, boolean, text)', async () => {
    await page.locator('.inspector .ins-head .icon-btn').click();
    await page.waitForSelector('.react-flow__edge-dep path.dep-line', { state: 'attached', timeout: 8000 }).catch(async (e) => {
      console.log('DEBUG edges:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.react-flow__edge')].map((x) => x.getAttribute('data-id') ?? x.className.baseVal))));
      console.log('DEBUG tables:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.react-flow__node-table')].map((x) => [x.getAttribute('data-id'), x.style.transform, getComputedStyle(x).visibility]))));
      throw e;
    });
    const pt = await page.evaluate(() => {
      const p = document.querySelector('.react-flow__edge-dep path.dep-line');
      const m = p.getPointAtLength(p.getTotalLength() / 2); const c = p.getScreenCTM();
      return { x: m.x * c.a + c.e, y: m.y * c.d + c.f };
    });
    await page.mouse.click(pt.x, pt.y);
    await page.waitForSelector('.inspector .ins-dep-edge');
    const props = section('Custom properties');
    for (const [k, v] of [['freq', '5'], ['live', 'true'], ['owner', 'data team']]) {
      const last = props.locator('.ins-check').last();
      await last.locator('input').first().fill(k); await last.locator('input').nth(1).fill(v); await last.locator('button').click(); await settle();
    }
  }, (s) => s.includes("Dep d {\n  a -> b\n  freq: 5\n  live: true\n  owner: 'data team'\n}"));

  await page.waitForTimeout(500);
  const status = await page.textContent('.status');
  if (!status.includes('No errors')) { failures++; console.log('FAIL final document has errors', status); }
  await alive('end');
  return failures;
}
