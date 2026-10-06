const { chromium } = require(process.env.PREFRONTAL_PLAYWRIGHT_MODULE || 'playwright');
const { mkdir, readFile } = require('node:fs/promises');
const assert = require('node:assert/strict');

(async () => {
  const base = process.env.PREFRONTAL_TEST_URL || 'http://127.0.0.1:8893/';
  const deck = JSON.parse(await readFile('presentation-content.json', 'utf8'));
  await mkdir('.validation', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const watchErrors = page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400 && response.url().startsWith(base)) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
  };
  const trackIntervals = async context => context.addInitScript(() => {
    const start = window.setInterval.bind(window);
    const stop = window.clearInterval.bind(window);
    const active = new Map();
    let created = 0;
    window.setInterval = (callback, delay, ...args) => {
      const id = start(callback, delay, ...args);
      active.set(id, Number(delay));
      created += 1;
      return id;
    };
    window.clearInterval = id => { active.delete(id); return stop(id); };
    window.__intervalSnapshot = () => ({ created, active: [...active.values()] });
  });
  const goto = async (page, id) => {
    await page.goto(`${base}#${id}`);
    await page.locator(`[data-slide="${id}"]`).waitFor({ state: 'visible' });
  };
  const noOverflow = async page => {
    const metrics = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert(metrics.scroll <= metrics.width + 1, `Horizontal overflow: ${JSON.stringify(metrics)}`);
  };
  const waitForMotion = async (page, selector, playing) => page.waitForFunction(({ selector, playing }) => {
    const svg = document.querySelector(selector);
    return svg && svg.dataset.playing === String(playing) && svg.animationsPaused() === !playing;
  }, { selector, playing }, { timeout: 6000 });
  const diagramState = async svg => svg.evaluate(node => ({
    step: Number(node.dataset.currentStep), time: node.getCurrentTime(), paused: node.animationsPaused(), playing: node.dataset.playing,
    title: node.closest('.mechanism-figure').querySelector('.stage-title').textContent,
    detail: node.closest('.mechanism-figure').querySelector('.stage-detail').textContent
  }));
  const dotsVisible = async svg => svg.evaluate(node => [...node.querySelectorAll('.m-dot')].filter(dot => {
    for (let item = dot; item && item !== node.parentElement; item = item.parentElement) {
      const style = getComputedStyle(item);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    }
    return true;
  }).length);
  const assertHighlight = async svg => {
    const state = await svg.evaluate(node => {
      const step = node.dataset.currentStep;
      const selected = node.querySelector(`.m-node[data-stage][data-step="${step}"]`);
      return {
        matches: [...node.querySelectorAll('.m-stage')].every(group => group.classList.contains('is-current') === (group.dataset.step === step)),
        width: selected && getComputedStyle(selected.querySelector('rect')).strokeWidth,
        stage: selected?.dataset.stage, title: node.closest('.mechanism-figure').querySelector('.stage-title').textContent
      };
    });
    assert(state.matches, 'Node and edge highlights must follow the diagram cursor.');
    assert.equal(state.width, '3px', 'The current node must remain highlighted while paused.');
    assert.equal(state.title, state.stage, 'The caption must describe the selected SVG stage.');
  };
  const assertIntervals = async (page, count) => {
    const intervals = await page.evaluate(() => window.__intervalSnapshot());
    assert.equal(intervals.active.length, count, `Expected ${count} live stage interval(s): ${JSON.stringify(intervals)}`);
    if (count) assert.deepEqual(intervals.active, [2400], 'A single 2400ms interval must advance the active diagram.');
    return intervals;
  };
  const assertAllPaused = async page => {
    const state = await page.locator('svg.motion-diagram').evaluateAll(nodes => nodes.map(svg => ({ playing: svg.dataset.playing, paused: svg.animationsPaused() })));
    assert(state.every(svg => svg.playing === 'false' && svg.paused), `All diagrams must pause: ${JSON.stringify(state)}`);
    await assertIntervals(page, 0);
  };
  const visibleRatio = async svg => svg.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    return width * height / (rect.width * rect.height);
  });
  const assertPdfPages = pdf => assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 15, 'The PDF must contain all 15 slides as separate pages.');
  const coverSelector = `[data-slide="${deck.slides[0].id}"] svg.motion-diagram`;
  const pipelineId = deck.slides.find(slide => slide.type === 'pipeline').id;
  const pipelineSelector = `[data-slide="${pipelineId}"] svg.motion-diagram`;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await trackIntervals(context);
    const page = await context.newPage();
    watchErrors(page);
    await goto(page, deck.slides[0].id);
    assert.equal(await page.locator('.slide').count(), 15);
    assert.equal(await page.locator('.slide:visible').count(), 1);
    assert.equal(await page.locator('.mechanism-figure').count(), 4);
    assert.equal(await page.locator('svg.motion-diagram').count(), 4);
    assert((await page.locator('svg.motion-diagram animateMotion').count()) >= 4);
    assert(await page.getByRole('button', { name: 'Motion off', exact: true }).isDisabled(), 'Reduced motion must disable playback, including manual override.');
    await assertAllPaused(page);
    for (const svg of await page.locator('svg.motion-diagram').all()) {
      assert.equal(await dotsVisible(svg), 0, 'Reduced motion must hide every moving packet.');
      assert(await svg.evaluate(node => [...node.querySelectorAll('.m-node[data-stage]')].every(group => getComputedStyle(group).opacity === '1')), 'Every node must remain readable in reduced motion.');
      assert(await svg.evaluate(node => node.querySelector('title').textContent.length > 0 && node.querySelector('desc').textContent.length > 0), 'Each diagram needs an accessible title and description.');
    }
    const reducedCover = page.locator(coverSelector);
    await assertHighlight(reducedCover);
    const inheritedBlue = await reducedCover.evaluate(svg => {
      const host = svg.closest('.mechanism-figure');
      host.style.setProperty('--blue', '#123456');
      const blue = getComputedStyle(svg.querySelector('marker path')).fill;
      host.style.removeProperty('--blue');
      return blue;
    });
    assert.equal(inheritedBlue, 'rgb(18, 52, 86)', 'SVG arrows must inherit the host CSS color variable.');
    await page.screenshot({ path: '.validation/cover-desktop.png', fullPage: true });
    await page.keyboard.press('ArrowRight');
    await page.locator('[data-slide="fragmented-context"]').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Slides', exact: false }).click();
    assert.equal(await page.locator('.overview-card:visible').count(), 15);
    await page.keyboard.press('Escape');
    assert(await page.locator('#overview').isHidden());
    for (const slide of deck.slides) { await goto(page, slide.id); await noOverflow(page); }
    await goto(page, 'human-review-routes');
    await page.screenshot({ path: '.validation/governance-desktop.png', fullPage: true });
    await goto(page, 'layered-memory');
    const memoryFigure = page.locator('.slide:visible .mechanism-figure');
    assert.equal(await memoryFigure.locator('.stage-title').innerText(), 'Original sources');
    const originalDetail = await memoryFigure.locator('.stage-detail').innerText();
    await memoryFigure.getByRole('button', { name: 'Next diagram stage', exact: true }).click();
    assert.equal(await memoryFigure.locator('.stage-title').innerText(), 'Structured memory');
    assert.notEqual(await memoryFigure.locator('.stage-detail').innerText(), originalDetail);
    await assertHighlight(memoryFigure.locator('svg.motion-diagram'));
    await memoryFigure.getByRole('button', { name: 'Previous diagram stage', exact: true }).click();
    assert.equal(await memoryFigure.locator('.stage-title').innerText(), 'Original sources');
    await assertAllPaused(page);
    await goto(page, 'upgrade-example');
    await page.getByRole('button', { name: 'Run illustrative checks' }).click();
    assert.equal(await page.locator('.demo-summary').getAttribute('data-outcome'), 'accept');
    for (const kind of ['lost-evidence', 'lost-exception', 'permission-change']) {
      await page.locator('#upgrade-kind').selectOption(kind);
      await page.getByRole('button', { name: 'Run illustrative checks' }).click();
      assert.equal(await page.locator('.demo-summary').getAttribute('data-outcome'), 'reject');
      assert((await page.locator('.check-mark.fail').count()) >= 1);
    }
    await page.screenshot({ path: '.validation/upgrade-desktop.png', fullPage: true });
    assertPdfPages(await page.pdf({ path: '.validation/presentation.pdf', printBackground: true, preferCSSPageSize: true }));
    await page.setViewportSize({ width: 390, height: 844 });
    for (const slide of deck.slides) { await goto(page, slide.id); await noOverflow(page); }
    await goto(page, deck.slides[0].id);
    await page.screenshot({ path: '.validation/cover-mobile.png', fullPage: true });
    await goto(page, 'upgrade-example');
    await page.locator('#upgrade-kind').selectOption('lost-exception');
    await page.getByRole('button', { name: 'Run illustrative checks' }).click();
    assert.equal(await page.locator('.demo-summary').getAttribute('data-outcome'), 'reject');
    await page.screenshot({ path: '.validation/upgrade-mobile.png', fullPage: true });
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.slide:visible').count(), 15);
    await assertAllPaused(page);

    const motionContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
    await trackIntervals(motionContext);
    const motionPage = await motionContext.newPage();
    watchErrors(motionPage);
    await goto(motionPage, deck.slides[0].id);
    const cover = motionPage.locator(coverSelector);
    await waitForMotion(motionPage, coverSelector, true);
    const initialIntervals = await assertIntervals(motionPage, 1);
    assert.equal(initialIntervals.created, 1, 'Autoplay must initialize with one interval.');
    const first = await diagramState(cover);
    await motionPage.waitForFunction(({ selector, step }) => Number(document.querySelector(selector).dataset.currentStep) !== step, { selector: coverSelector, step: first.step }, { timeout: 4000 });
    const advanced = await diagramState(cover);
    assert.notEqual(advanced.title, first.title, 'Autoplay must advance the caption with the stage cursor.');
    assert(advanced.time > first.time, 'Native SVG animation time must advance while playing.');
    assert((await dotsVisible(cover)) > 0, 'The current connector must show its moving packet.');
    await assertHighlight(cover);
    await motionPage.getByRole('button', { name: 'Pause motion', exact: true }).click();
    await waitForMotion(motionPage, coverSelector, false);
    const paused = await diagramState(cover);
    await motionPage.waitForTimeout(180);
    assert(Math.abs((await diagramState(cover)).time - paused.time) < 0.02, 'Native SVG time must stop when paused.');
    assert.equal(await dotsVisible(cover), 0, 'Paused diagrams must hide moving packets.');
    await assertIntervals(motionPage, 0);
    await motionPage.getByRole('button', { name: 'Play motion', exact: true }).click();
    await waitForMotion(motionPage, coverSelector, true);
    const beforeManual = await diagramState(cover);
    const stageCount = await cover.locator('.m-node[data-stage]').count();
    await motionPage.locator('.slide:visible .stage-next').click();
    await waitForMotion(motionPage, coverSelector, false);
    const manual = await diagramState(cover);
    assert.equal(manual.step, (beforeManual.step + 1) % stageCount, 'Next stage must advance and pause autoplay.');
    assert(manual.detail.length > 0, 'Manual stages must retain explanatory text.');
    await assertHighlight(cover);
    await assertIntervals(motionPage, 0);
    await motionPage.waitForTimeout(2550);
    assert.equal((await diagramState(cover)).step, manual.step, 'The stage cursor must remain stopped after manual stepping.');
    await motionPage.locator('.slide:visible .stage-prev').click();
    assert.equal((await diagramState(cover)).step, beforeManual.step);
    await motionPage.getByRole('button', { name: 'Play motion', exact: true }).click();
    await waitForMotion(motionPage, coverSelector, true);
    await assertIntervals(motionPage, 1);
    await motionPage.waitForFunction(({ selector, step }) => Number(document.querySelector(selector).dataset.currentStep) !== step, { selector: coverSelector, step: beforeManual.step }, { timeout: 4000 });

    const inactiveStep = (await diagramState(cover)).step;
    await motionPage.locator('.nav-item').nth(deck.slides.findIndex(slide => slide.id === pipelineId)).click();
    await waitForMotion(motionPage, pipelineSelector, true);
    const pipeline = motionPage.locator(pipelineSelector);
    assert((await diagramState(cover)).paused, 'A previous slide must pause its native animation.');
    const pipelineStep = (await diagramState(pipeline)).step;
    await motionPage.waitForFunction(({ selector, step }) => Number(document.querySelector(selector).dataset.currentStep) !== step, { selector: pipelineSelector, step: pipelineStep }, { timeout: 4000 });
    assert.equal((await diagramState(cover)).step, inactiveStep, 'An inactive slide must retain its stage cursor.');
    await assertIntervals(motionPage, 1);
    await motionPage.getByRole('button', { name: 'Slides', exact: false }).click();
    await assertAllPaused(motionPage);
    const overviewSteps = await motionPage.locator('svg.motion-diagram').evaluateAll(nodes => nodes.map(svg => svg.dataset.currentStep));
    await motionPage.waitForTimeout(2550);
    assert.deepEqual(await motionPage.locator('svg.motion-diagram').evaluateAll(nodes => nodes.map(svg => svg.dataset.currentStep)), overviewSteps, 'Overview must stop all stage cursors.');
    await motionPage.keyboard.press('Escape');
    await waitForMotion(motionPage, pipelineSelector, true);
    await motionPage.emulateMedia({ reducedMotion: 'reduce' });
    await waitForMotion(motionPage, pipelineSelector, false);
    assert(await motionPage.getByRole('button', { name: 'Motion off', exact: true }).isDisabled(), 'A changed reduced-motion preference must also override prior playback.');
    await assertAllPaused(motionPage);
    assert.equal(await dotsVisible(pipeline), 0);

    await motionPage.emulateMedia({ reducedMotion: 'no-preference' });
    await motionPage.setViewportSize({ width: 390, height: 480 });
    await goto(motionPage, deck.slides[0].id);
    await cover.evaluate(svg => svg.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await waitForMotion(motionPage, coverSelector, true);
    assert((await visibleRatio(cover)) >= 0.25, 'The mobile SVG must be eligible before checking viewport pausing.');
    await cover.evaluate(svg => {
      const rect = svg.getBoundingClientRect();
      window.scrollTo({ top: window.scrollY + rect.top - innerHeight + rect.height * 0.2, behavior: 'instant' });
    });
    await waitForMotion(motionPage, coverSelector, false);
    const ratio = await visibleRatio(cover);
    assert(ratio > 0.15 && ratio < 0.25, `A partly visible SVG below the 25% threshold must pause (ratio ${ratio}).`);
    const offscreen = await diagramState(cover);
    await assertIntervals(motionPage, 0);
    await motionPage.waitForTimeout(2550);
    const stillOffscreen = await diagramState(cover);
    assert.equal(stillOffscreen.step, offscreen.step, 'Below-threshold diagrams must stop the stage cursor.');
    assert(Math.abs(stillOffscreen.time - offscreen.time) < 0.02, 'Below-threshold diagrams must stop native SVG time.');
    await cover.evaluate(svg => svg.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await waitForMotion(motionPage, coverSelector, true);
    await assertIntervals(motionPage, 1);
    await motionPage.waitForFunction(({ selector, step }) => Number(document.querySelector(selector).dataset.currentStep) !== step, { selector: coverSelector, step: offscreen.step }, { timeout: 4000 });
    await motionPage.evaluate(() => window.addEventListener('beforeprint', () => {
      window.__printSnapshot = {
        diagrams: [...document.querySelectorAll('svg.motion-diagram')].map(svg => ({ playing: svg.dataset.playing, paused: svg.animationsPaused() })),
        intervals: window.__intervalSnapshot()
      };
    }, { once: true }));
    assertPdfPages(await motionPage.pdf({ printBackground: true, preferCSSPageSize: true }));
    const printState = await motionPage.evaluate(() => window.__printSnapshot);
    assert(printState?.diagrams.every(svg => svg.playing === 'false' && svg.paused), 'The real print lifecycle must pause every native SVG.');
    assert.equal(printState.intervals.active.length, 0, 'Printing must stop every stage cursor interval.');
    await motionPage.emulateMedia({ media: 'print' });
    assert.equal(await dotsVisible(cover), 0, 'Printed diagrams must hide moving packets.');

    const staticContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
    const staticPage = await staticContext.newPage();
    watchErrors(staticPage);
    await staticPage.goto(base);
    const fallback = staticPage.locator('.static-presentation');
    assert(await fallback.isVisible(), 'JavaScript-disabled users need a readable presentation fallback.');
    assert.equal(await fallback.locator('.slide:visible').count(), 15);
    assert.equal(await fallback.locator('svg.motion-diagram').count(), 4);
    assert.equal(await fallback.locator('animateMotion').count(), 0, 'Static fallback SVGs must contain no native motion.');
    assert.equal(await fallback.locator('.slide h1, .slide h2').count(), 15);
    for (const svg of await fallback.locator('svg.motion-diagram').all()) {
      assert(await svg.isVisible());
      assert(await svg.locator('title').textContent());
      assert(await svg.locator('desc').textContent());
      assert((await svg.locator('text').count()) > 0, 'Static diagrams must preserve their visible labels.');
    }
    await noOverflow(staticPage);
    assertPdfPages(await staticPage.pdf({ printBackground: true, preferCSSPageSize: true }));
    await staticPage.setViewportSize({ width: 390, height: 844 });
    assert.equal(await fallback.locator('.slide:visible').count(), 15);
    await noOverflow(staticPage);
    assert.deepEqual(errors, []);
    console.log('Browser checks: PASS (15 desktop/mobile slides; 4 SVG stage diagrams; native autoplay/pause/manual/resume; one stage interval; inactive/overview/25% visibility pausing; reduced motion; inherited CSS color; navigation; 4 upgrade scenarios; PDF/print; 15-slide JavaScript-disabled fallback; no page errors)');
    console.log(`Checked URL: ${base}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
