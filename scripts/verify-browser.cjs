const { chromium } = require(process.env.PREFRONTAL_PLAYWRIGHT_MODULE || 'playwright');
const { mkdir, readFile } = require('node:fs/promises');
const assert = require('node:assert/strict');

(async () => {
  const base = process.env.PREFRONTAL_TEST_URL || 'http://127.0.0.1:8893/';
  const deck = JSON.parse(await readFile('presentation-content.json', 'utf8'));
  await mkdir('.validation', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && response.url().startsWith(base)) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
  const goto = async id => {
    await page.goto(`${base}#${id}`);
    await page.locator(`[data-slide="${id}"]`).waitFor({ state: 'visible' });
  };
  const noOverflow = async () => {
    const metrics = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert(metrics.scroll <= metrics.width + 1, `Horizontal overflow: ${JSON.stringify(metrics)}`);
  };
  try {
    await goto(deck.slides[0].id);
    assert.equal(await page.locator('.slide').count(), 15);
    assert.equal(await page.locator('.slide:visible').count(), 1);
    assert.equal(await page.locator('svg.motion-diagram').count(), 4);
    assert((await page.locator('svg.motion-diagram animateMotion').count()) >= 4);
    assert(await page.locator('.slide:visible svg.motion-diagram').evaluate(svg => svg.animationsPaused()));
    await page.getByRole('button', { name: 'Play motion' }).click();
    assert.equal(await page.locator('.slide:visible svg.motion-diagram').evaluate(svg => svg.animationsPaused()), false);
    const timeBefore = await page.locator('.slide:visible svg.motion-diagram').evaluate(svg => svg.getCurrentTime());
    await page.waitForTimeout(180);
    const timeAfter = await page.locator('.slide:visible svg.motion-diagram').evaluate(svg => svg.getCurrentTime());
    assert(timeAfter > timeBefore, 'SVG animation time must advance when motion is enabled.');
    await page.getByRole('button', { name: 'Pause motion' }).click();
    assert(await page.locator('.slide:visible svg.motion-diagram').evaluate(svg => svg.animationsPaused()));
    await page.screenshot({ path: '.validation/cover-desktop.png', fullPage: true });
    await page.keyboard.press('ArrowRight');
    await page.locator('[data-slide="fragmented-context"]').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Slides', exact: false }).click();
    assert.equal(await page.locator('.overview-card:visible').count(), 15);
    await page.keyboard.press('Escape');
    assert(await page.locator('#overview').isHidden());
    for (const slide of deck.slides) { await goto(slide.id); await noOverflow(); }
    await goto('human-review-routes');
    await page.screenshot({ path: '.validation/governance-desktop.png', fullPage: true });
    await goto('layered-memory');
    await page.getByRole('button', { name: /Original sources/ }).click();
    assert.match(await page.locator('.memory-detail').innerText(), /permitted originals/i);
    await goto('upgrade-example');
    await page.getByRole('button', { name: 'Run illustrative checks' }).click();
    assert.equal(await page.locator('.demo-summary').getAttribute('data-outcome'), 'accept');
    for (const kind of ['lost-evidence', 'lost-exception', 'permission-change']) {
      await page.locator('#upgrade-kind').selectOption(kind);
      await page.getByRole('button', { name: 'Run illustrative checks' }).click();
      assert.equal(await page.locator('.demo-summary').getAttribute('data-outcome'), 'reject');
      assert((await page.locator('.check-mark.fail').count()) >= 1);
    }
    await page.screenshot({ path: '.validation/upgrade-desktop.png', fullPage: true });
    await page.pdf({ path: '.validation/presentation.pdf', printBackground: true, preferCSSPageSize: true });
    await page.setViewportSize({ width: 390, height: 844 });
    for (const slide of deck.slides) { await goto(slide.id); await noOverflow(); }
    await goto(deck.slides[0].id);
    await page.screenshot({ path: '.validation/cover-mobile.png', fullPage: true });
    await goto('upgrade-example');
    await page.locator('#upgrade-kind').selectOption('lost-exception');
    await page.getByRole('button', { name: 'Run illustrative checks' }).click();
    assert.equal(await page.locator('.demo-summary').getAttribute('data-outcome'), 'reject');
    await page.screenshot({ path: '.validation/upgrade-mobile.png', fullPage: true });
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.slide:visible').count(), 15);
    assert.deepEqual(errors, []);
    console.log('Browser checks: PASS (15 desktop and mobile slides; 4 animated SVG diagrams; pause and reduced motion; navigation; overview; memory selection; 4 upgrade scenarios; print visibility; no page errors)');
    console.log(`Checked URL: ${base}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
