/* Syntax view helper for the browser tests (#149/#166: the view is lazy and organized, so a section only exists once its data is loaded and its family and body are open).
   openSyntax(page, id): switch to the Syntax view, poll the supported API strudelCraft.syntax.go(id) until it accepts (false while the data is loading), then wait for the
   section's rendered body (examples or run buttons). Returns the section selector. Never select rows by the old flat-list selectors. */
export async function openSyntax(page, id, { timeout = 60000, minRuns = 0 } = {}) {
  await page.evaluate(() => window.__sc.setView('syntax'));
  await page.waitForFunction((i) => !!(window.strudelCraft.syntax && window.strudelCraft.syntax.go(i)), id, { timeout });
  const sel = '#sx-' + id;
  await page.waitForFunction(([s, n]) => { const el = document.querySelector(s); return !!el && el.querySelectorAll('.sx-ex').length > 0 && el.querySelectorAll('.sx-run').length >= n; }, [sel, minRuns], { timeout });
  return sel;
}
/* open the section and click the n-th run button from inside the page, retried (the view re-renders on strudel:ready) */
export async function runSyntaxEntry(page, id, n, { timeout = 60000 } = {}) {
  for (let k = 0; k < 5; k++) {
    await openSyntax(page, id, { timeout, minRuns: n + 1 }); await page.waitForTimeout(500);
    if (await page.evaluate(([s, i]) => { const b = document.querySelectorAll(s + ' .sx-run')[i]; if (!b) return false; b.click(); return true; }, ['#sx-' + id, n])) return true;
  }
  return false;
}
