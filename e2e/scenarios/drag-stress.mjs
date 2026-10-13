// Drags a sticky note and a table to every canvas edge and holds them there (React Flow auto-pans),
// many times. Guards against the drag-end freeze: saving the position used to happen inside a
// state updater, which React may re-run; that looped forever and the page stopped responding.
export default async function ({ page }) {
  const settle = () => page.waitForTimeout(300);
  // a frozen page makes input calls hang forever: give every step a deadline
  const within = async (what, p, ms = 5000) => {
    const r = await Promise.race([p.then(() => 'ok'), new Promise((res) => setTimeout(() => res('TIMEOUT'), ms))]);
    if (r === 'TIMEOUT') throw new Error(`page stopped responding: ${what}`);
  };
  await page.locator('.tbl', { has: page.locator('.tbl-name', { hasText: /^posts$/ }) }).locator('.tbl-head').click();
  await page.locator('.edit-tools button', { hasText: 'Group' }).click(); await settle();
  await page.locator('.edit-tools button', { hasText: 'Note' }).click(); await page.waitForTimeout(800);
  const pane = await page.locator('.react-flow__pane').boundingBox();
  const items = [['note', page.locator('.sticky-head', { hasText: 'note_1' })], ['table', page.locator('.tbl-head', { hasText: 'follows' })]];
  const edges = [[pane.x + pane.width - 3, null], [pane.x + 3, null], [null, pane.y + pane.height - 3], [null, pane.y + 3]];
  let drags = 0;
  for (let round = 0; round < 4; round++) {
    for (const [label, item] of items) {
      for (const [ex, ey] of edges) {
        const b = await item.boundingBox();
        if (!b) throw new Error(`${label} not on screen`);
        const sx = b.x + 20, sy = b.y + 8, tx = ex ?? sx, ty = ey ?? sy;
        await within('press', page.mouse.move(sx, sy).then(() => page.mouse.down()));
        for (let i = 1; i <= 30; i++) await within(`drag ${label}`, page.mouse.move(sx + ((tx - sx) * i) / 30, sy + ((ty - sy) * i) / 30));
        for (let i = 0; i < 12; i++) { await within(`hold ${label} at edge`, page.mouse.move(tx + (i % 2), ty + (i % 3))); await page.waitForTimeout(60); }
        await within(`drop ${label}`, page.mouse.up());
        await within(`after drop ${label}`, page.evaluate(() => 1));
        drags++;
        await within('fit view', page.locator('.toolbar:not(.edit-tools) button').nth(2).click()); await page.waitForTimeout(250);
      }
    }
  }
  const status = await page.textContent('.status');
  if (!status.includes('No errors')) throw new Error(status);
  console.log(`${drags} edge drags, page responsive throughout`);
  return 0;
}
