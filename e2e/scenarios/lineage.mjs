// Dependencies, inactive refs, example records, custom properties (table/column/group/note/project/dep) — GUI only.
export default async function ({ page, alive, outDir, expandSections }) {
  await expandSections();
  const dbml = () => page.evaluate(() => [...document.querySelectorAll('.cm-line')].map((l) => l.textContent).join('\n'));
  const settle = () => page.waitForTimeout(300);
  let failures = 0;
  const check = async (label, cond, extra = '') => { if (!cond) failures++; console.log(cond ? 'PASS' : 'FAIL', label, cond ? '' : extra); };
  const commit = async (text) => { await page.keyboard.press('Meta+A'); await page.keyboard.type(text); await page.keyboard.press('Enter'); await settle(); };
  const ins = page.locator('.inspector');
  const openTable = async (name) => { await page.locator('.tbl', { has: page.locator('.tbl-name', { hasText: new RegExp(`^${name}$`) }) }).locator('.tbl-head').dblclick(); await page.waitForSelector('.inspector .ins-field'); await settle(); };
  const addProp = async (section, key, value) => {
    const last = section.locator('.ins-props > .ins-check').last();
    await last.locator('input').first().fill(key);
    await last.locator('input').nth(1).fill(value);
    await last.locator('button').click(); await settle();
  };
  const drag = async (fromLoc, toLoc) => {
    await fromLoc.hover();
    const d = await fromLoc.locator('.react-flow__handle-right.conn').first().boundingBox();
    const tb = await toLoc.boundingBox();
    await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
    await page.mouse.down();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 15 });
    await page.mouse.up(); await settle();
  };

  // 1. dependency mode: column -> column, then table header -> table header
  await page.locator('.seg button', { hasText: 'Dependency' }).click();
  await drag(page.locator('.row[data-field-id="users.id"]'), page.locator('.row[data-field-id="follows.followed_user_id"]'));
  let src = await dbml();
  await check('column-level dep by drag', src.includes('Dep {\n  users.id -> follows.followed_user_id\n}'), src);
  await drag(page.locator('.tbl', { has: page.locator('.tbl-name', { hasText: /^posts$/ }) }).locator('.tbl-head'), page.locator('.tbl', { has: page.locator('.tbl-name', { hasText: /^follows$/ }) }).locator('.tbl-head'));
  src = await dbml();
  await check('table-level dep by drag (headers)', src.includes('Dep {\n  posts -> follows\n}'), src);
  await check('dep lines drawn', (await page.locator('.react-flow__edge-dep').count()) === 2, String(await page.locator('.react-flow__edge-dep').count()));
  await page.locator('.seg button', { hasText: 'Relationship' }).click();

  // 2. edit a dep: click its line, name, colour, note, custom property, add an edge
  const pt = await page.evaluate(() => {
    const p = [...document.querySelectorAll('.react-flow__edge-dep path.dep-line')][0];
    const m = p.getPointAtLength(p.getTotalLength() / 2); const c = p.getScreenCTM();
    return { x: m.x * c.a + c.e, y: m.y * c.d + c.f };
  });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForSelector('.inspector .ins-dep-edge');
  await ins.locator('.ins-row', { hasText: 'Name' }).locator('input').click(); await commit('user_feed');
  await ins.locator('.swatch[title="#16a34a"]').click(); await settle();
  await ins.locator('.ins-row', { hasText: 'Note' }).locator('textarea').click(); await page.keyboard.type('nightly copy');
  await ins.locator('.ins-row', { hasText: 'Name' }).locator('input').click(); await settle();
  await addProp(ins.locator('.ins-section', { hasText: 'Custom properties' }), 'owner', 'data team');
  await ins.locator('button.link', { hasText: 'Edge' }).click();
  const e2 = ins.locator('.ins-dep-edge').nth(1);
  await e2.locator('select').nth(1).selectOption('users.username');
  await e2.locator('select').nth(3).selectOption('follows.created_at');
  await ins.locator('.btn.primary', { hasText: 'Apply' }).click(); await settle();
  src = await dbml();
  await check('dep edited', /Dep user_feed \[color: #16a34a, note: 'nightly copy'\] \{\n  users\.id -> follows\.followed_user_id\n  users\.username -> follows\.created_at\n  owner: 'data team'\n\}/.test(src), src);

  // 3. inactive ref
  await openTable('posts');
  await ins.locator('.ins-section', { hasText: 'Relationships' }).locator('.ins-link-row').first().click();
  await page.waitForSelector('.inspector .ins-ops');
  await ins.locator('label', { hasText: 'Inactive' }).click(); await settle();
  src = await dbml();
  await check('inactive ref', src.includes('Ref: posts.user_id > users.id [inactive]'), src);
  await check('inactive ref drawn dashed', (await page.locator('.rel.inactive').count()) === 1);

  // 4. custom properties: table, column, group (create one), note, project
  await openTable('users');
  await addProp(ins.locator('.ins-section', { hasText: 'Custom properties' }).first(), 'owner', 'auth team');
  const emailField = ins.locator('.ins-field').nth(2);
  await emailField.locator('button[title="Default value and note"]').click();
  await addProp(emailField, 'pii', 'yes');
  src = await dbml();
  await check('table + column custom properties', src.includes("Metadata Table users {\n  owner: 'auth team'\n}") && src.includes("Metadata Column users.email {\n  pii: 'yes'\n}"), src);
  await page.locator('.sticky-head', { hasText: 'tips' }).dblclick(); await page.waitForSelector('.inspector textarea'); await settle();
  await addProp(ins.locator('.ins-section', { hasText: 'Custom properties' }), 'author', 'ben');
  await page.locator('.edit-tools button', { hasText: 'Project' }).click(); await settle();
  await addProp(ins.locator('.ins-section', { hasText: 'Custom properties' }), 'owner', 'platform');
  src = await dbml();
  await check('note + project custom properties', src.includes("Metadata Note tips {\n  author: 'ben'\n}") && /Project project \{\n  owner: 'platform'\n\}/.test(src), src);

  // 5. example records
  await openTable('users');
  const rec = ins.locator('.ins-section', { hasText: 'Sample data' });
  await rec.locator('.ins-section-head button.link').click();
  await rec.locator('.btn.primary', { hasText: 'Create' }).click(); await settle();
  await rec.locator('label', { hasText: 'Example data' }).click(); await settle();
  src = await dbml();
  await check('example records', src.includes('Records users(id, username, email, role, created_at) [example] {'), src);

  // 6. renaming keeps everything valid
  await ins.locator('.ins-row').first().locator('input').click(); await commit('members');
  src = await dbml();
  await check('rename follows deps and metadata', src.includes('members.id -> follows.followed_user_id') && src.includes('Metadata Table members') && src.includes('Metadata Column members.email') && src.includes('Records members('), src);
  await page.waitForTimeout(400);
  await check('no DBML errors', (await page.textContent('.status')).includes('No errors'), await page.textContent('.status'));
  await page.screenshot({ path: `${outDir}/gui4.png` });
  await alive('end');
  return failures;
}
