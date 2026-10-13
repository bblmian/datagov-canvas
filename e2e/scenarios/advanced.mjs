// Second GUI-only scenario: Project, partials, alias, index details, checks, composite/named/coloured
// refs and sample data — everything that used to need typed DBML.
export default async function ({ page, alive, outDir, expandSections }) {
  await expandSections();
  const dbml = () => page.evaluate(() => [...document.querySelectorAll('.cm-line')].map((l) => l.textContent).join('\n'));
  const settle = () => page.waitForTimeout(250);
  let failures = 0;
  const check = async (label, cond, extra = '') => {
    if (!cond) failures++;
    console.log(cond ? 'PASS' : 'FAIL', label, cond ? '' : extra);
  };
  const commit = async (text) => { await page.keyboard.press('Meta+A'); await page.keyboard.type(text); await page.keyboard.press('Enter'); await settle(); };
  const tool = (name) => page.locator('.edit-tools button', { hasText: name });
  const ins = page.locator('.inspector');
  const row = (label) => ins.locator('.ins-row', { has: page.locator('.ins-label', { hasText: new RegExp(`^${label}$`) }) });
  const openTable = async (name) => { await page.locator('.tbl', { has: page.locator('.tbl-name', { hasText: new RegExp(`^${name}$`) }) }).locator('.tbl-head').dblclick(); await page.waitForSelector('.inspector .ins-field'); await settle(); };

  // the starter diagram has users / posts / follows; start from it
  // 1. Project
  await tool('Project').click();
  await row('Name').locator('input').click(); await commit('blog');
  await row('Database').locator('input').click(); await commit('PostgreSQL');
  await row('Note').locator('textarea').click(); await page.keyboard.type('Blog schema'); await row('Name').locator('input').click(); await settle();
  let src = await dbml();
  await check('project block', src.startsWith("Project blog {\n  database_type: 'PostgreSQL'\n  Note: 'Blog schema'\n}"), src.slice(0, 200));

  // 2. partial with two columns, included by posts
  await tool('Partials').click();
  await ins.locator('button', { hasText: 'New partial' }).click(); await settle();
  await ins.locator('.ins-enum').first().locator('.ins-row').first().locator('input').click(); await commit('timestamps');
  const pf = ins.locator('.ins-enum').first().locator('.ins-field');
  await pf.first().locator('.f-name').click(); await commit('updated_at');
  await pf.first().locator('.f-type').click(); await commit('timestamp');
  await pf.first().locator('.chip', { hasText: 'PK' }).click(); await settle();
  await pf.first().locator('.chip', { hasText: 'AI' }).click(); await settle();
  src = await dbml();
  await check('partial created and edited', /TablePartial timestamps \{\n  updated_at timestamp\n\}/.test(src), src);
  await openTable('posts');
  await ins.locator('.ins-chips select').selectOption('timestamps'); await settle();
  src = await dbml();
  await check('partial included in table', /Table posts \[[^\]]*\] \{\n  ~timestamps\n/.test(src), src);
  await ins.locator('.ins-chip button[title^="Move down"]').click(); await settle();
  await check('injection moved below the first column', /\{\n  id integer \[pk, increment\]\n  ~timestamps\n/.test(await dbml()), await dbml());
  await ins.locator('.ins-chip button[title^="Move up"]').click(); await settle();
  await check('injected column drawn on canvas', (await page.locator('.row[data-field-id="posts.updated_at"]').count()) === 1);

  // 3. alias
  await row('Alias').locator('input').click(); await commit('P');
  src = await dbml();
  await check('alias', /Table posts as P \[/.test(src), src);

  // 4. column check + table check
  const idField = ins.locator('.ins-field').first();
  await idField.locator('button[title="Default value and note"]').click();
  await idField.locator('.ins-row', { hasText: 'Check' }).locator('input').click(); await commit('id > 0');
  await ins.locator('.ins-section', { hasText: 'Checks' }).locator('.ins-check input').first().click();
  await page.keyboard.type('user_id <> id'); await page.keyboard.press('Enter'); await settle();
  src = await dbml();
  await check('column check', src.includes('id integer [pk, increment, check: `id > 0`]'), src);
  await check('table check', /checks \{\n    `user_id <> id`\n  \}/.test(src), src);

  // 5. index details: expand the existing (user_id, created_at) index and set name/type/note
  const ixSec = ins.locator('.ins-section', { hasText: 'Indexes' });
  await ixSec.locator('button[title="Columns, name, type and note"]').first().click();
  await ixSec.locator('.ins-row', { hasText: 'Name' }).locator('input').click(); await commit('ix_posts_user');
  await ixSec.locator('.ins-row', { hasText: 'Type' }).locator('input').click(); await commit('btree');
  await ixSec.locator('.ins-row', { hasText: 'Note' }).locator('textarea').click(); await page.keyboard.type('latest posts per user');
  await ixSec.locator('.ins-row', { hasText: 'Name' }).locator('input').click(); await settle();
  src = await dbml();
  await check('index name/type/note', src.includes("(user_id, created_at) [name: 'ix_posts_user', type: btree, note: 'latest posts per user']"), src);
  // expression index
  await ixSec.locator('button.link', { hasText: 'Index' }).click();
  await ixSec.locator('.ins-index-form input[placeholder^="Expression"]').fill('lower(title)');
  await ixSec.locator('.ins-index-form .btn.primary').click(); await settle();
  src = await dbml();
  await check('expression index', src.includes('`lower(title)`'), src);

  // 6. composite, named relationship from the table panel: posts.(user_id, id) -> follows.(following_user_id, followed_user_id)
  const relSec = ins.locator('.ins-section', { hasText: 'Relationships' });
  await relSec.locator('button.link', { hasText: 'Relationship' }).click();
  await relSec.locator('.ins-row', { hasText: 'References' }).locator('select').selectOption('follows');
  await relSec.locator('.ins-pair').first().locator('select').first().selectOption('posts.user_id');
  await relSec.locator('.ins-pair').first().locator('select').nth(1).selectOption('follows.following_user_id');
  await relSec.locator('button.link', { hasText: 'Column pair' }).click();
  await relSec.locator('.ins-pair').nth(1).locator('select').first().selectOption('posts.id');
  await relSec.locator('.ins-pair').nth(1).locator('select').nth(1).selectOption('follows.followed_user_id');
  await relSec.locator('.ins-row', { hasText: 'Name' }).locator('input').fill('fk_composite');
  await relSec.locator('.btn.primary', { hasText: 'Create' }).click(); await settle();
  src = await dbml();
  await check('composite named ref', src.includes('Ref fk_composite: posts.(user_id, id) > follows.(following_user_id, followed_user_id)'), src);

  // 7. edit that ref in the ref panel: colour, rename, drop a column pair
  await relSec.locator('.ins-link-row', { hasText: '(user_id, id)' }).click();
  await page.waitForSelector('.inspector .ins-ops');
  await ins.locator('.swatch[title="#dc2626"]').click(); await settle();
  await row('Name').locator('input').click(); await commit('fk_pair');
  const pairSec = ins.locator('.ins-section', { hasText: 'Columns' });
  await pairSec.locator('.ins-pair').nth(1).locator('button[title="Remove pair"]').click();
  await pairSec.locator('.btn.primary', { hasText: 'Apply' }).click(); await settle();
  src = await dbml();
  await check('ref colour, name, columns', src.includes('Ref fk_pair: posts.user_id > follows.following_user_id [color: #dc2626]'), src);
  const pane = await page.locator('.react-flow__pane').boundingBox();
  await page.mouse.click(pane.x + 20, pane.y + pane.height - 120);
  await page.mouse.move(pane.x + 30, pane.y + pane.height - 110);
  await page.waitForTimeout(300);
  const stroke = await page.evaluate(() => [...document.querySelectorAll('.react-flow__edge .rel-line')].map((p) => getComputedStyle(p).stroke));
  await check('coloured edge drawn', stroke.includes('rgb(220, 38, 38)'), JSON.stringify(stroke));

  // 8. sample data for users (clicking the empty canvas above already closed the inspector)
  await check('clicking the empty canvas closes the inspector', (await ins.count()) === 0);
  await openTable('users');
  const recSec = ins.locator('.ins-section', { hasText: 'Sample data' });
  await recSec.locator('.ins-section-head button.link').click();
  await recSec.locator('.btn.primary', { hasText: 'Create' }).click(); await settle();
  const cell = (r, c) => recSec.locator('.ins-grid tbody tr').nth(r).locator('td').nth(c).locator('input');
  await cell(0, 0).click(); await commit('1');
  await cell(0, 1).click(); await commit('alice');
  await cell(0, 2).click(); await commit('alice@example.com');
  await recSec.locator('button.link', { hasText: 'Row' }).click(); await settle();
  await cell(1, 0).click(); await commit('2');
  await cell(1, 1).click(); await commit('bob');
  src = await dbml();
  await check('sample data', /Records users\(id, username, email, role, created_at\) \{\n  1, 'alice', 'alice@example.com', null, null\n  2, 'bob', null, null, null\n\}/.test(src), src);

  await page.waitForTimeout(500);
  const status = await page.textContent('.status');
  await check('no DBML errors', status.includes('No errors'), status);
  await page.screenshot({ path: `${outDir}/gui2-final.png` });

  await page.click('.dropdown >> text=Export');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.menu .menu-item', { hasText: 'PostgreSQL' }).click()]);
  const p = `${outDir}/gui2.sql`;
  await dl.saveAs(p);
  const sql = (await import('node:fs')).readFileSync(p, 'utf8');
  await check('SQL has INSERT, CHECK, index and FK', sql.includes('INSERT INTO') && /CHECK/i.test(sql) && sql.includes('ix_posts_user') && sql.includes('fk_pair'), sql.slice(0, 1500));
  await alive('end');
  return failures;
}
