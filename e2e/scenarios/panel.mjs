// The inspector's progressive disclosure and the canvas trash can: empty sections start collapsed,
// rarely used settings sit under "More", a table/note dragged onto the trash is deleted (with an
// undo toast), and clicking the empty canvas closes the panel.
export default async function ({ page, alive, outDir }) {
  const dbml = () => page.evaluate(() => [...document.querySelectorAll('.cm-line')].map((l) => l.textContent).join('\n'));
  const settle = () => page.waitForTimeout(300);
  let failures = 0;
  const check = async (label, cond, extra = '') => {
    if (!cond) failures++;
    console.log(cond ? 'PASS' : 'FAIL', label, cond ? '' : extra);
    if (!cond) await page.screenshot({ path: `${outDir}/panel-fail.png` });
  };
  const commit = async (text) => { await page.keyboard.press('Meta+A'); await page.keyboard.type(text); await page.keyboard.press('Enter'); await settle(); };
  const ins = page.locator('.inspector');
  const section = (title) => ins.locator('.ins-section', { has: page.locator('.ins-section-head', { hasText: new RegExp(`^${title}`) }) });
  const isOpen = async (title) => (await section(title).locator('.ins-section-toggle').getAttribute('aria-expanded')) === 'true';
  const tbl = (name) => page.locator('.tbl', { has: page.locator('.tbl-name', { hasText: new RegExp(`^${name}$`) }) });
  const openTable = async (name) => { await tbl(name).locator('.tbl-head').dblclick(); await page.waitForSelector('.inspector .ins-field'); await settle(); };
  const field = (name) => ins.locator('.ins-field', { has: page.locator(`.f-name[value="${name}"]`) });

  await page.locator('.toolbar:not(.edit-tools) button').nth(2).click(); await page.waitForTimeout(400);
  await openTable('posts');

  // 1. disclosure: sections with content are open with a count, empty ones collapsed
  await check('indexes section shows its count', (await section('Indexes').locator('.ins-count').textContent()) === '1');
  await check('empty sections start collapsed', !(await isOpen('Checks')) && !(await isOpen('Sample data')) && !(await isOpen('Dependencies')));
  await check('"More" is collapsed and holds the alias', !(await isOpen('More')) && (await section('More').locator('.ins-row').count()) === 0);
  await section('More').locator('.ins-section-toggle').click(); await settle();
  await section('More').locator('.ins-row', { hasText: 'Alias' }).locator('input').click(); await commit('P');
  await check('alias written from the More section', /Table posts as P \[/.test(await dbml()), await dbml());

  // 2. the "+" of a collapsed section opens it
  await section('Sample data').locator('.ins-section-action button').click(); await settle();
  await check('"+" on a collapsed section opens it with its form', (await isOpen('Sample data')) && (await section('Sample data').locator('.ins-index-form').count()) === 1);

  // 3. column order lives behind ⋯
  await field('title').locator('button[title="Default value and note"]').click();
  await field('title').locator('button[title="Move up"]').click(); await settle();
  await check('column moved up from the expanded row', /\{\n  title varchar \[not null\]\n  id integer/.test(await dbml()), await dbml());

  // 4. clicking the empty canvas closes the inspector
  const pane = await page.locator('.react-flow__pane').boundingBox();
  await page.mouse.click(pane.x + 30, pane.y + pane.height - 120); await settle();
  await check('clicking the empty canvas closes the inspector', (await ins.count()) === 0);

  // 5. trash: hidden at rest, shown while dragging, deletes on drop, undo brings it back
  await check('no trash at rest', (await page.locator('.trash-zone').count()) === 0);
  const head = await tbl('follows').locator('.tbl-head').boundingBox();
  await page.mouse.move(head.x + 40, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x + 80, head.y + 40, { steps: 5 });
  await page.waitForSelector('.trash-zone', { timeout: 3000 }).catch(() => {});
  await check('trash appears while dragging', (await page.locator('.trash-zone').count()) === 1);
  const zone = await page.locator('.trash-zone').boundingBox();
  await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2, { steps: 12 });
  await settle();
  await check('trash lights up under the pointer', (await page.locator('.trash-zone.over').count()) === 1);
  await page.screenshot({ path: `${outDir}/panel-trash.png` });
  await page.mouse.up(); await page.waitForTimeout(600);
  let src = await dbml();
  await check('table dropped on the trash is deleted with its refs', !src.includes('Table follows') && !src.includes('follows.'), src);
  await check('trash gone after the drop', (await page.locator('.trash-zone').count()) === 0);
  await check('undo toast offered', (await page.locator('.toast .toast-action').count()) === 1);
  await page.locator('.toast .toast-action').click(); await page.waitForTimeout(600);
  src = await dbml();
  await check('undo from the toast restores the table and its refs', src.includes('Table follows') && src.includes('follows.following_user_id'), src);

  // a note dragged elsewhere is not deleted
  const note = await page.locator('.sticky-head').first().boundingBox();
  await page.mouse.move(note.x + 30, note.y + note.height / 2);
  await page.mouse.down();
  await page.mouse.move(note.x + 160, note.y - 60, { steps: 10 });
  await page.mouse.up(); await settle();
  await check('a drag that misses the trash deletes nothing', (await dbml()).includes('Note tips'));

  await alive('end');
  return failures;
}
