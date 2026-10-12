// GUI coverage: every element kind and setting of the installed DBML grammar must be exercised
// through the canvas / inspector (never by typing DBML), each step checked against the DBML text.
import { readFileSync } from 'node:fs';

const grammar = readFileSync(new URL('../../node_modules/@dbml/parse/dist/dbml-parse.mjs', import.meta.url), 'utf8');
const grammarEnum = (first) => {
  const start = grammar.indexOf(first);
  return [...grammar.slice(start, grammar.indexOf(', e;', start)).matchAll(/e\.\w+ = "([^"]+)"/g)].map((m) => m[1]);
};
const KINDS = grammarEnum('e.Table = "table"');
const SETTINGS = grammarEnum('e.Color = "color"');

// Hand-written constructs the GUI must be able to edit (the only DBML typed in this run).
const SEED = `Table users {
  id integer [primary key]
  email varchar [null]
  nick varchar
}

Table orders [dep: <- users] {
  id integer [pk]
  user_id integer [ref: > users.id]
  copy_id integer [dep: <- users.id]
}
`;

export default async function ({ page, alive, outDir }) {
  const covered = new Set();
  let failures = 0;
  const dbml = () => page.evaluate(() => [...document.querySelectorAll('.cm-line')].map((l) => l.textContent).join('\n'));
  const settle = () => page.waitForTimeout(300);
  /** one GUI step: run it, then check the DBML; on success the grammar items count as covered */
  const step = async (label, items, action, ok) => {
    try {
      await action();
      await settle();
      const src = await dbml();
      const pass = !!ok(src);
      if (pass) items.forEach((i) => covered.add(i)); else failures++;
      console.log(pass ? 'PASS' : 'FAIL', label, `[${items.join(', ')}]`, pass ? '' : `\n${src}`);
    } catch (e) {
      failures++;
      console.log('FAIL', label, String(e).split('\n')[0]);
      await page.screenshot({ path: `${outDir}/coverage-fail.png` });
    }
  };
  const commit = async (text) => { await page.keyboard.press('Meta+A'); await page.keyboard.type(text); await page.keyboard.press('Enter'); await settle(); };
  const ins = page.locator('.inspector');
  const tool = (name) => page.locator('.edit-tools button', { hasText: name });
  const section = (title) => ins.locator('.ins-section', { has: page.locator('.ins-section-head', { hasText: new RegExp(`^${title}`) }) });
  const row = (label) => ins.locator('.ins-row', { has: page.locator('.ins-label', { hasText: new RegExp(`^${label}$`) }) }).first();
  const field = (name) => ins.locator('.ins-field', { has: page.locator(`.f-name[value="${name}"]`) });
  const tableHead = (name) => page.locator('.tbl', { has: page.locator('.tbl-name', { hasText: new RegExp(`^${name}$`) }) }).locator('.tbl-head');
  const openTable = async (name) => { await tableHead(name).dblclick(); await page.waitForSelector('.inspector .ins-field'); await settle(); };
  const closeInspector = async () => { if (await ins.count()) await ins.locator('.ins-head .icon-btn').click(); await settle(); };
  const fit = async () => { await page.locator('.toolbar:not(.edit-tools) button').nth(2).click(); await page.waitForTimeout(400); };
  const addProp = async (scope, key, value) => {
    const last = scope.locator('.ins-props > .ins-check').last();
    await last.locator('input').first().fill(key);
    await last.locator('input').nth(1).fill(value);
    await last.locator('button').click();
  };
  const dragDot = async (from, to) => {
    await from.hover();
    const d = await from.locator('.react-flow__handle-right.conn').first().boundingBox();
    const tb = await to.boundingBox();
    await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
    await page.mouse.down();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 15 });
    await page.mouse.up();
  };
  const clickEdge = async (selector) => {
    const pt = await page.evaluate((sel) => {
      const p = document.querySelector(sel);
      const m = p.getPointAtLength(p.getTotalLength() / 2); const c = p.getScreenCTM();
      return { x: m.x * c.a + c.e, y: m.y * c.d + c.f };
    }, selector);
    await page.mouse.click(pt.x, pt.y);
  };

  // seed
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.insertText(SEED);
  await page.waitForTimeout(1200);
  await fit();

  // ---- table, column flags, synonyms -----------------------------------------------------
  await step('rename table, note, header colour', ['table', 'note', 'headercolor'], async () => {
    await openTable('users');
    await row('Name').locator('input').click(); await commit('members');
    await row('Note').locator('textarea').click(); await page.keyboard.type('people'); await row('Alias').locator('input').click();
    await settle();
    await ins.locator('.swatch[title="#2563eb"]').first().click();
  }, (s) => s.includes("Table members [note: 'people', headercolor: #2563eb] {"));

  await step('PK off removes a hand-written `primary key`; PK on writes pk', ['primary key', 'pk'], async () => {
    await field('id').locator('.chip', { hasText: 'PK' }).click(); await settle();
    if (!(await dbml()).includes('  id integer\n')) throw new Error('primary key not removed');
    await field('id').locator('.chip', { hasText: 'PK' }).click();
  }, (s) => s.includes('  id integer [pk]'));

  await step('NN on replaces a hand-written `null`', ['null', 'not null'], async () => {
    await field('email').locator('.chip', { hasText: 'NN' }).click();
  }, (s) => s.includes('email varchar [not null]'));

  await step('unique, increment, default, check', ['unique', 'increment', 'default', 'check'], async () => {
    await field('email').locator('.chip', { hasText: 'UQ' }).click(); await settle();
    await field('id').locator('.chip', { hasText: 'AI' }).click(); await settle();
    await field('nick').locator('button[title="Default value and note"]').click();
    await field('nick').locator('.ins-row', { hasText: 'Default' }).locator('input').click(); await commit('anon');
    await field('nick').locator('.ins-row', { hasText: 'Check' }).locator('input').click(); await commit('length(nick) > 2');
  }, (s) => s.includes('email varchar [not null, unique]') && s.includes('id integer [pk, increment]') && s.includes("nick varchar [default: 'anon', check: `length(nick) > 2`]"));

  await step('custom properties of a table and a column (Metadata)', ['metadata'], async () => {
    await addProp(section('Custom properties'), 'owner', 'auth team'); await settle();
    await addProp(field('nick'), 'pii', 'no');
  }, (s) => s.includes("Metadata Table members {\n  owner: 'auth team'\n}") && s.includes("Metadata Column members.nick {\n  pii: 'no'\n}"));

  await step('index with name and type', ['indexes', 'name', 'type'], async () => {
    const ix = section('Indexes');
    await ix.locator('button.link').click();
    await ix.locator('.ins-index-cols label', { hasText: 'email' }).click();
    await ix.locator('.ins-index-form .btn.primary').click(); await settle();
    await ix.locator('button[title="Columns, name, type and note"]').click();
    await ix.locator('.ins-row', { hasText: 'Name' }).locator('input').click(); await commit('ix_email');
    await ix.locator('.ins-row', { hasText: 'Type' }).locator('input').click(); await commit('hash');
  }, (s) => s.includes("email [name: 'ix_email', type: hash]"));

  await step('table check constraint', ['checks'], async () => {
    const ck = section('Checks');
    await ck.locator('.ins-check input').first().fill('id > 0');
    await ck.locator('.ins-check input').nth(1).fill('positive_id');
    await ck.locator('.ins-check button').last().click();
  }, (s) => /checks \{\n    `id > 0` \[name: 'positive_id'\]\n  \}/.test(s));

  await step('sample data with the example flag', ['records', 'example'], async () => {
    const rec = section('Sample data');
    await rec.locator('.ins-section-head button.link').click();
    await rec.locator('.btn.primary', { hasText: 'Create' }).click(); await settle();
    await rec.locator('.ins-grid tbody tr').first().locator('td').first().locator('input').click(); await commit('1');
    await rec.locator('label', { hasText: 'Example data' }).click();
  }, (s) => s.includes('Records members(id, email, nick) [example] {\n  1, null, null\n}'));

  // ---- hand-written inline ref and inline deps, edited through the GUI ---------------------
  await step('inline ref (`[ref: > …]`) changed in the relationship panel', ['ref'], async () => {
    await closeInspector();
    await openTable('orders');
    await section('Relationships').locator('.ins-link-row').first().click();
    await page.waitForSelector('.inspector .ins-ops');
    await ins.locator('.ins-op', { hasText: 'One to one' }).click();
  }, (s) => s.includes('user_id integer [ref: - members.id]'));

  await step('relationship actions, colour, inactive', ['delete', 'update', 'color', 'inactive'], async () => {
    await row('On delete').locator('select').selectOption('cascade'); await settle();
    await row('On update').locator('select').selectOption('restrict'); await settle();
    await ins.locator('.swatch[title="#dc2626"]').click(); await settle();
    await ins.locator('label', { hasText: 'Inactive' }).click();
  }, (s) => s.includes('Ref: orders.user_id - members.id [delete: cascade, update: restrict, color: #dc2626, inactive]') && s.includes('  user_id integer\n'));

  await step('inline column dep (`[dep: <- …]`) edited: becomes a Dep block', ['dep'], async () => {
    await closeInspector(); await fit();
    await clickEdge('.react-flow__edge-dep path.dep-line');
    await page.waitForSelector('.inspector .ins-dep-edge');
    const kind = await ins.locator('.ins-dep-edge').first().locator('select').nth(1).inputValue();
    if (!kind) { // the table-level one was hit: delete it through the panel, then take the column one
      await ins.locator('button', { hasText: 'Delete dependency' }).click(); await settle();
      if ((await dbml()).includes('[dep: <- members]')) throw new Error('table-level inline dep not removed');
      await clickEdge('.react-flow__edge-dep path.dep-line');
      await page.waitForSelector('.inspector .ins-dep-edge');
    }
    await ins.locator('.swatch[title="#16a34a"]').click();
  }, (s) => s.includes('Dep [color: #16a34a] {\n  members.id -> orders.copy_id\n}') && s.includes('  copy_id integer\n'));

  // ---- relationship and dependency by dragging ---------------------------------------------
  await step('relationship by dragging a column dot', ['ref'], async () => {
    await closeInspector(); await fit();
    await dragDot(page.locator('.row[data-field-id="orders.id"]'), page.locator('.row[data-field-id="members.nick"]'));
  }, (s) => s.includes('Ref: members.nick > orders.id')); // dragged from a key: the other column references it

  await step('dependency by dragging between table headers (Dependency mode)', ['dep'], async () => {
    await page.locator('.seg button', { hasText: 'Dependency' }).click();
    await dragDot(tableHead('members'), tableHead('orders'));
    await page.locator('.seg button', { hasText: 'Relationship' }).click();
  }, (s) => s.includes('Dep {\n  members -> orders\n}'));

  // ---- enum, sticky note, group, partial, project ------------------------------------------
  await step('enum with a value note', ['enum', 'note'], async () => {
    await tool('Enums').click();
    await ins.locator('button', { hasText: 'New enum' }).click(); await settle();
    await ins.locator('.ins-enum-head input').click(); await commit('status');
    await ins.locator('.ins-enum-value').first().locator('textarea').click(); await page.keyboard.type('first value');
    await ins.locator('.ins-enum-head input').click(); await settle();
  }, (s) => s.includes("Enum status {\n  value_1 [note: 'first value']\n  value_2\n}"));

  await step('sticky note with colour', ['note', 'color'], async () => {
    await tool('Note').click(); await page.waitForSelector('.inspector textarea'); await settle();
    await ins.locator('textarea').click(); await page.keyboard.press('Meta+A'); await page.keyboard.type('remember');
    await ins.locator('input').first().click(); await settle();
    await ins.locator('.swatch[title="#dcfce7"]').click();
  }, (s) => s.includes("Note note_1 [color: #dcfce7] {\n  'remember'\n}"));

  await step('table group with colour and note', ['tablegroup', 'color', 'note'], async () => {
    await closeInspector();
    await tableHead('members').click();
    await page.keyboard.down('Meta'); await tableHead('orders').click(); await page.keyboard.up('Meta');
    await tool('Group').click(); await page.waitForSelector('.inspector .ins-members'); await settle();
    await ins.locator('.swatch[title="#9333ea"]').click(); await settle();
    await row('Note').locator('textarea').click(); await page.keyboard.type('shop'); await row('Name').locator('input').click();
  }, (s) => /TableGroup group_1 \[color: #9333ea\] \{\n  members\n  orders\n  Note: 'shop'\n\}/.test(s));

  await step('table partial with header colour, included by a table', ['tablepartial', 'headercolor'], async () => {
    await tool('Partials').click();
    await ins.locator('button', { hasText: 'New partial' }).click(); await settle();
    await ins.locator('.ins-enum').first().locator('.ins-row').first().locator('input').click(); await commit('audit');
    await ins.locator('.ins-enum').first().locator('.swatch[title="#ca8a04"]').click(); await settle();
    await openTable('orders');
    await ins.locator('.ins-chips select').selectOption('audit');
  }, (s) => s.includes('TablePartial audit [headercolor: #ca8a04] {') && /Table orders \{\n  ~audit\n/.test(s));

  await step('custom property of a column the table gets from a partial', ['metadata'], async () => {
    await tool('Partials').click(); await settle();
    const pf = ins.locator('.ins-enum').first().locator('.ins-field').first();
    await pf.locator('.f-name').click(); await commit('changed_at');
    await openTable('orders');
    const inj = section('Columns from partials').locator('.ins-field.injected').first();
    await inj.locator('.icon-btn').click();
    await addProp(inj, 'audit', 'yes');
  }, (s) => s.includes("Metadata Column orders.changed_at {\n  audit: 'yes'\n}"));

  await step('project name and database', ['project'], async () => {
    await tool('Project').click();
    await row('Name').locator('input').click(); await commit('shop');
    await row('Database').locator('input').click(); await commit('PostgreSQL');
  }, (s) => s.startsWith("Project shop {\n  database_type: 'PostgreSQL'\n}"));

  // ---- diagram view with every kind of sub-block ---------------------------------------------
  await step('a table in a second schema (for Schemas in views)', ['table'], async () => {
    await tool('Table').click(); await page.waitForTimeout(500);
    await ins.locator('.ins-row').first().locator('input').click(); await commit('s.audit_log');
  }, (s) => s.includes('Table s.audit_log {'));

  await step('diagram view: Tables, TableGroups, Schemas, Notes', ['diagramview', 'tables', 'tablegroups', 'schemas', 'notes'], async () => {
    await tool('Views').click();
    await ins.locator('button', { hasText: 'New view' }).click(); await settle();
    await ins.locator('label', { hasText: 'Chosen tables' }).click(); await settle();
    await ins.locator('.ins-members').first().locator('label', { hasText: /^ ?members$/ }).click(); await settle();
    await ins.locator('.ins-sub-head', { hasText: 'Whole groups' }).locator('xpath=following-sibling::div[1]').locator('label').first().click(); await settle();
    await ins.locator('.ins-sub-head', { hasText: 'Whole schemas' }).locator('xpath=following-sibling::div[1]').locator('label', { hasText: 's' }).last().click(); await settle();
    await ins.locator('.ins-modes label', { hasText: 'Chosen' }).last().click();
  }, (s) => /DiagramView view_1 \{\n  Tables \{\n    members\n  \}\n  TableGroups \{\n    group_1\n  \}\n  Schemas \{\n    s\n  \}\n  Notes \{\n    note_1\n  \}\n\}/.test(s));

  await page.locator('.toolbar select').last().selectOption('').catch(() => {});
  await page.waitForTimeout(500);
  const status = await page.textContent('.status');
  if (!status.includes('No errors')) { failures++; console.log('FAIL final document has errors', status); }
  await page.screenshot({ path: `${outDir}/coverage.png` });

  const all = [...KINDS, ...SETTINGS];
  const missing = all.filter((x) => !covered.has(x));
  console.log(`grammar items: ${KINDS.length} element kinds + ${SETTINGS.length} settings; covered through the GUI: ${all.length - missing.length}`);
  if (missing.length) { failures++; console.log('NOT COVERED:', missing.join(', ')); }
  await alive('end');
  return failures;
}
