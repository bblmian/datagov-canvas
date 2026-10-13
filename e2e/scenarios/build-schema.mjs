// Builds a schema using only the graphical editor, checking the DBML text after each step.
export default async function ({ page, alive, outDir, expandSections }) {
  await expandSections();
  const dbml = () => page.evaluate(() => [...document.querySelectorAll('.cm-line')].map((l) => l.textContent).join('\n'));
  const status = () => page.textContent('.status');
  const settle = () => page.waitForTimeout(250);
  let failures = 0;
  const check = async (label, cond, extra = '') => {
    const ok = !!cond;
    if (!ok) failures++;
    console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : extra);
  };
  const commit = async (text) => { await page.keyboard.press('Meta+A'); await page.keyboard.type(text); await page.keyboard.press('Enter'); await settle(); };
  const tool = (name) => page.locator('.edit-tools button', { hasText: name });
  const ins = page.locator('.inspector');

  // fresh diagram via the diagram list, then remove its starter table through the GUI
  await page.click('.dropdown >> text=My diagrams');
  await page.locator('.menu >> text=New diagram').click();
  await page.waitForTimeout(800);

  // 1. new table from the toolbar, named in the inspector
  await tool('Table').click();
  await page.waitForSelector('.inspector .ins-row input');
  await settle();
  await commit('users');
  let src = await dbml();
  await check('table created and renamed', /Table users \{\n  id integer \[pk, increment\]\n\}/.test(src), src);

  // 2. columns
  await ins.locator('.ins-section-head', { hasText: 'Columns' }).locator('button.link').click();
  await settle();
  await commit('email');
  const emailRow = ins.locator('.ins-field').nth(1);
  await emailRow.locator('.f-type').click();
  await commit('varchar(255)');
  await emailRow.locator('.chip', { hasText: 'NN' }).click(); await settle();
  await emailRow.locator('.chip', { hasText: 'UQ' }).click(); await settle();
  await emailRow.locator('button[title="Default value and note"]').click();
  await emailRow.locator('.ins-field-more .ins-row', { hasText: 'Note' }).locator('textarea').click();
  await page.keyboard.type('login email');
  await emailRow.locator('.f-name').click(); await settle();
  src = await dbml();
  await page.screenshot({ path: `${outDir}/gui-table.png` });
  await check('column with type, flags and note', src.includes("email varchar(255) [not null, unique, note: 'login email']"), src);

  // 3. second table by double-clicking empty canvas
  const pane = await page.locator('.react-flow__pane').boundingBox();
  await page.mouse.dblclick(pane.x + pane.width * 0.15, pane.y + pane.height * 0.75);
  await page.waitForSelector('.inspector .ins-sub');
  await settle();
  await commit('posts');
  await ins.locator('.ins-section-head', { hasText: 'Columns' }).locator('button.link').click();
  await settle();
  await commit('user_id');
  await ins.locator('.ins-field').nth(1).locator('.f-type').click();
  await commit('integer');
  src = await dbml();
  await check('second table via double-click', /Table posts \{\n  id integer \[pk, increment\]\n  user_id integer\n\}/.test(src), src);
  await page.keyboard.press('Escape');
  await page.click('.inspector .ins-head .icon-btn');
  await settle();
  await page.click('.toolbar button[title="Fit to screen"]').catch(() => {});
  await page.waitForTimeout(500);

  // 4. relationship by dragging posts.user_id onto users.id
  const fromRow = page.locator('.row[data-field-id="posts.user_id"]');
  await fromRow.hover();
  const dot = fromRow.locator('.react-flow__handle-right.conn');
  const d = await dot.boundingBox();
  const target = await page.locator('.row[data-field-id="users.id"]').boundingBox();
  await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
  console.log('dot box', JSON.stringify(d), 'target', JSON.stringify(target), 'el at dot:', await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e.className + ' / ' + e.parentElement?.className; }, { x: d.x + d.width / 2, y: d.y + d.height / 2 }));
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 15 });
  await page.screenshot({ path: `${outDir}/gui-middrag.png` });
  console.log('connection line?', await page.locator('.react-flow__connectionline').count(), 'el at target:', await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e.className + ' / ' + e.closest('[data-field-id]')?.dataset.fieldId; }, { x: target.x + target.width / 2, y: target.y + target.height / 2 }));
  await page.mouse.up();
  await settle();
  src = await dbml();
  await check('ref created by drag', src.includes('Ref: posts.user_id > users.id'), src);
  await check('edge drawn', (await page.locator('.react-flow__edge').count()) === 1);

  // 5. edit the relationship: click the line
  const pt = await page.evaluate(() => {
    const p = document.querySelector('.react-flow__edge path.rel-line');
    const m = p.getPointAtLength(p.getTotalLength() / 2);
    const ctm = p.getScreenCTM();
    return { x: m.x * ctm.a + ctm.e, y: m.y * ctm.d + ctm.f };
  });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForSelector('.inspector .ins-ops');
  await page.locator('.ins-op', { hasText: 'One to one' }).click(); await settle();
  await ins.locator('.ins-row', { hasText: 'On delete' }).locator('select').selectOption('cascade'); await settle();
  src = await dbml();
  await check('ref type and action', src.includes('Ref: posts.user_id - users.id [delete: cascade]'), src);
  await page.locator('.ins-op', { hasText: 'Many to one' }).click(); await settle();
  await ins.locator('button', { hasText: 'Swap sides' }).click(); await settle();
  src = await dbml();
  await page.screenshot({ path: `${outDir}/gui-ref.png` });
  await check('swap direction', src.includes('Ref: users.id < posts.user_id [delete: cascade]'), src);

  // 6. enum, used as a column type
  await tool('Enums').click();
  await ins.locator('button', { hasText: 'New enum' }).click(); await settle();
  await ins.locator('.ins-enum-head input').click();
  await commit('post_status');
  await ins.locator('.ins-enum .link').click(); await settle();
  src = await dbml();
  await page.screenshot({ path: `${outDir}/gui-enum.png` });
  await check('enum created', /Enum post_status \{\n  value_1\n  value_2\n  value_3\n\}/.test(src), src);
  await page.locator('.tbl', { hasText: 'posts' }).locator('.tbl-head').dblclick();
  await page.waitForSelector('.inspector .ins-field');
  await ins.locator('.ins-section-head', { hasText: 'Columns' }).locator('button.link').click(); await settle();
  await commit('status');
  await ins.locator('.ins-field').nth(2).locator('.f-type').click();
  await commit('post_status');
  src = await dbml();
  await check('enum column', src.includes('status post_status'), src);

  // 7. index
  await ins.locator('.ins-section-head', { hasText: 'Indexes' }).locator('button.link').click();
  await ins.locator('.ins-index-cols label', { hasText: 'user_id' }).click();
  await ins.locator('.ins-index-cols label', { hasText: 'status' }).click();
  await ins.locator('.ins-index-form label', { hasText: 'Unique' }).last().click();
  await ins.locator('.ins-index-form .btn.primary').click(); await settle();
  src = await dbml();
  await page.screenshot({ path: `${outDir}/gui-index.png` });
  await check('index added', /Indexes \{\n    \(user_id, status\) \[unique\]\n  \}/.test(src), src);

  // 8. table note + header colour
  await ins.locator('.ins-row', { hasText: 'Note' }).first().locator('textarea').click();
  await page.keyboard.type('Blog posts');
  await ins.locator('.ins-row', { hasText: 'Name' }).first().locator('input').click(); await settle();
  await ins.locator('.swatch[title="#16a34a"]').click(); await settle();
  src = await dbml();
  await check('table note and colour', src.includes("Table posts [note: 'Blog posts', headercolor: #16a34a] {"), src);

  // 9. delete a column, then undo from the canvas toolbar
  await ins.locator('.ins-field').nth(2).hover();
  await ins.locator('.ins-field').nth(2).locator('button[title="Delete column"]').click(); await settle();
  await check('column deleted', !(await dbml()).includes('status post_status'));
  await page.locator('.edit-tools button[title^="Undo"]').click(); await settle();
  await check('undo restores it', (await dbml()).includes('status post_status'));

  // 10. sticky note
  await tool('Note').click();
  await page.waitForSelector('.inspector textarea');
  await settle();
  await ins.locator('textarea').click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.type('Remember: users own posts');
  await ins.locator('input').first().click(); await settle();
  src = await dbml();
  await check('sticky note', src.includes("'Remember: users own posts'"), src);

  // 11. group: select both tables, then Group
  await page.locator('.inspector .ins-head .icon-btn').click();
  await page.locator('.tbl', { hasText: 'users' }).locator('.tbl-head').click();
  await page.keyboard.down('Meta');
  await page.locator('.tbl', { hasText: 'posts' }).locator('.tbl-head').click();
  await page.keyboard.up('Meta');
  await tool('Group').click(); await settle();
  await ins.locator('.ins-row', { hasText: 'Name' }).locator('input').click();
  await commit('blog');
  src = await dbml();
  await check('group', /TableGroup blog \{\n  users\n  posts\n\}/.test(src), src);

  // 12. rename a table: refs, group and positions follow
  await page.locator('.tbl', { hasText: 'users' }).first().locator('.tbl-head').dblclick();
  await page.waitForTimeout(200);
  await ins.locator('.ins-row', { hasText: 'Name' }).first().locator('input').click();
  await commit('members');
  src = await dbml();
  await check('rename follows refs and group', src.includes('Ref: members.id < posts.user_id [delete: cascade]') && /TableGroup blog \{\n  members\n  posts\n\}/.test(src), src);

  // 13. delete a table with the Delete key, then undo
  await page.locator('.inspector .ins-head .icon-btn').click();
  await page.locator('.tbl', { hasText: 'posts' }).locator('.tbl-head').click();
  await page.keyboard.press('Delete'); await settle();
  src = await dbml();
  await check('delete key removes table and its ref', !src.includes('Table posts') && !src.includes('Ref:'), src);
  await page.keyboard.press('Meta+z'); await settle();
  await check('⌘Z on the canvas brings it back', (await dbml()).includes('Table posts'));

  await page.waitForTimeout(500);
  await check('no DBML errors', (await status()).includes('No errors'), await status());
  console.log('SCROLL', await page.evaluate(() => ['html', 'body', '#root', '.app', '.workspace', '.canvas', '.canvas .react-flow', '.editor-pane'].map((q) => { const e = document.querySelector(q); return `${q}:${e?.scrollLeft},${e?.scrollTop}`; }).join(' ')));
  await page.screenshot({ path: `${outDir}/gui-final.png` });

  // the result exports as SQL
  await page.click('.dropdown >> text=Export');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.menu .menu-item', { hasText: 'PostgreSQL' }).click()]);
  const p = `${outDir}/gui.sql`;
  await dl.saveAs(p);
  const sql = (await import('node:fs')).readFileSync(p, 'utf8');
  await check('exports to PostgreSQL', sql.includes('CREATE TABLE "members"') && sql.includes('FOREIGN KEY'), sql.slice(0, 400));
  await alive('end');
  return failures;
}
