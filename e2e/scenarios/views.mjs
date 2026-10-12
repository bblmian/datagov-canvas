// Diagram views, purely through the GUI.
export default async function ({ page, alive, outDir }) {
  const dbml = () => page.evaluate(() => [...document.querySelectorAll('.cm-line')].map((l) => l.textContent).join('\n'));
  const settle = () => page.waitForTimeout(300);
  let failures = 0;
  const check = async (label, cond, extra = '') => { if (!cond) failures++; console.log(cond ? 'PASS' : 'FAIL', label, cond ? '' : extra); };
  const commit = async (text) => { await page.keyboard.press('Meta+A'); await page.keyboard.type(text); await page.keyboard.press('Enter'); await settle(); };
  const tables = () => page.evaluate(() => [...document.querySelectorAll('.tbl .tbl-name')].map((e) => e.textContent).sort());
  const ins = page.locator('.inspector');

  await page.locator('.edit-tools button', { hasText: 'Views' }).click();
  await ins.locator('button', { hasText: 'New view' }).click(); await settle();
  let src = await dbml();
  await check('view created', /DiagramView view_1 \{\n  Tables \{\n    \*\n  \}\n  Notes \{\n    \*\n  \}\n\}/.test(src), src);
  await check('new view is shown, banner visible', (await page.locator('.view-banner').count()) === 1);
  await check('all tables visible in an "all" view', JSON.stringify(await tables()) === JSON.stringify(['follows', 'posts', 'users']), JSON.stringify(await tables()));

  await ins.locator('label', { hasText: 'Chosen tables' }).click(); await settle();
  await ins.locator('.ins-members label', { hasText: 'users' }).click(); await settle();
  await ins.locator('.ins-members label', { hasText: 'posts' }).click(); await settle();
  await ins.locator('.ins-modes label', { hasText: 'None' }).click(); await settle();
  src = await dbml();
  await check('view lists two tables, no notes', /DiagramView view_1 \{\n  Tables \{\n    users\n    posts\n  \}\n\}/.test(src), src);
  await check('canvas shows only the view', JSON.stringify(await tables()) === JSON.stringify(['posts', 'users']) && (await page.locator('.sticky').count()) === 0, JSON.stringify(await tables()));
  await check('banner counts hidden tables', (await page.textContent('.view-banner')).includes('1 table'), await page.textContent('.view-banner'));
  await check('ref between shown tables drawn', (await page.locator('.react-flow__edge').count()) === 1);

  await ins.locator('.ins-enum-head input').click(); await commit('core');
  src = await dbml();
  await check('view renamed, still shown', src.includes('DiagramView core {') && (await page.locator('.toolbar select').last().inputValue()) === 'view:core', src);

  // switch from the canvas toolbar
  await page.locator('.toolbar select').last().selectOption(''); await settle();
  await check('"Everything" shows all again', (await tables()).length === 3 && (await page.locator('.view-banner').count()) === 0);
  await page.locator('.toolbar select').last().selectOption('view:core'); await settle();
  await check('view selected again', (await tables()).length === 2);

  // a table created while the view is shown joins it
  await page.locator('.edit-tools button', { hasText: 'Table' }).first().click();
  await page.waitForTimeout(400);
  await ins.locator('.ins-row').first().locator('input').click(); await commit('tags');
  await page.waitForTimeout(400);
  src = await dbml();
  await check('new table joins the shown view', /DiagramView core \{\n  Tables \{\n    users\n    posts\n    tags\n  \}\n\}/.test(src) && (await tables()).includes('tags'), src);

  // renaming a table updates the view
  await page.locator('.tbl', { has: page.locator('.tbl-name', { hasText: /^users$/ }) }).locator('.tbl-head').dblclick();
  await page.waitForTimeout(300);
  await ins.locator('.ins-row').first().locator('input').click(); await commit('members');
  src = await dbml();
  await check('rename follows into the view', src.includes('    members\n    posts\n    tags') && (await tables()).includes('members'), src);

  await page.waitForTimeout(400);
  await check('no DBML errors', (await page.textContent('.status')).includes('No errors'), await page.textContent('.status'));
  await page.screenshot({ path: `${outDir}/gui3-view.png` });

  // delete the view
  await page.locator('.edit-tools button', { hasText: 'Views' }).click(); await settle();
  await ins.locator('button[title="Delete view"]').click(); await settle();
  src = await dbml();
  await check('view deleted, everything shown', !src.includes('DiagramView') && (await tables()).length === 4 && (await page.locator('.toolbar select').count()) === 1, src);
  await alive('end');
  return failures;
}
