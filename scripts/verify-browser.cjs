const { chromium } = require(process.env.PREFRONTAL_PLAYWRIGHT_MODULE || 'playwright');
const { mkdir, readFile } = require('node:fs/promises');
const assert = require('node:assert/strict');

(async () => {
  const base = process.env.PREFRONTAL_TEST_URL || 'http://127.0.0.1:8893/';
  const deck = JSON.parse(await readFile('presentation-content.json', 'utf8'));
  const expectedSectors = ['telecom', 'utilities', 'healthcare', 'hospitality'];
  assert.equal(deck.slides.length, 22, 'The agreed release contains 22 slides.');
  assert.deepEqual(deck.industries.map(industry => industry.id).sort(), [...expectedSectors].sort());
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
  const assertPdfPages = pdf => assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, deck.slides.length, `The PDF must contain all ${deck.slides.length} slides as separate pages.`);
  const coverSelector = `[data-slide="${deck.slides[0].id}"] svg.motion-diagram`;
  const pipelineId = deck.slides.find(slide => slide.type === 'pipeline').id;
  const pipelineSelector = `[data-slide="${pipelineId}"] svg.motion-diagram`;
  const industryById = Object.fromEntries(deck.industries.map(industry => [industry.id, industry]));
  const normalized = text => text.replace(/\s+/g, ' ').trim();
  const assertIndustryEvidence = async (root, staticMode = false) => {
    for (const industry of deck.industries) {
      const caseId = `${industry.id}-context`;
      if (!staticMode) await goto(root, caseId);
      const panel = root.locator(staticMode ? `#static-${caseId}` : `[data-slide="${caseId}"]`);
      assert(await panel.isVisible(), `${industry.name} narrative must be visible during its acceptance check.`);
      const text = normalized(await panel.innerText());
      for (const key of ['value', 'label', 'scope', 'period', 'limitation', 'definition']) {
        assert(text.includes(normalized(industry.metric[key])), `${industry.name} must retain its metric ${key} in readable copy.`);
      }
      for (const key of staticMode ? ['task', 'problem', 'solution', 'output', 'humanGate'] : ['problem', 'solution', 'humanGate']) {
        assert(text.includes(normalized(industry[key])), `${industry.name} must retain its ${key} narrative.`);
      }
      if (!staticMode) {
        const figure = panel.locator('.mechanism-figure');
        const flow = figure.locator('svg.motion-diagram');
        assert.equal((await diagramState(flow)).step, 0);
        assert.equal(normalized(await figure.locator('.stage-detail').textContent()), normalized(industry.task), 'The first case stage must explain the task.');
        await figure.locator('.stage-next').click();
        const evidenceDetail = normalized(await figure.locator('.stage-detail').textContent());
        for (const input of industry.inputs) assert(evidenceDetail.includes(normalized(input)), 'The evidence stage must explain every required input.');
        await assertHighlight(flow);
        await figure.locator('.stage-next').click();
        assert.equal(normalized(await figure.locator('.stage-detail').textContent()), normalized(industry.humanGate));
        await assertHighlight(flow);
        await figure.locator('.stage-next').click();
        const outputDetail = normalized(await figure.locator('.stage-detail').textContent());
        assert(outputDetail.includes(normalized(industry.output)), 'The result stage must explain the sector output.');
        assert(outputDetail.includes(normalized(industry.test)), 'The result stage must preserve its proposed acceptance check.');
        await assertHighlight(flow);
      }
      const citation = panel.locator('a.industry-citation, .industry-citation a');
      assert.equal(await citation.count(), 1, `${industry.name} needs one direct primary-source citation.`);
      assert.equal(new URL(await citation.getAttribute('href'), base).href, new URL(industry.metric.sourceUrl).href);
      assert((await citation.textContent()).includes(industry.metric.sourceTitle));
      const chart = panel.locator('svg.insight-chart');
      assert.equal(await chart.count(), 1, `${industry.name} case needs its evidence chart.`);
      if (!staticMode) await root.screenshot({ path: `.validation/${caseId}-desktop.png`, fullPage: true });
    }
    const sourceSlide = deck.slides.find(slide => slide.type === 'industry-sources');
    if (!staticMode) await goto(root, sourceSlide.id);
    const sourcePanel = root.locator(staticMode ? `#static-${sourceSlide.id}` : `[data-slide="${sourceSlide.id}"]`);
    const sourceLinks = await sourcePanel.locator('a[href]').evaluateAll(nodes => nodes.map(node => ({ url: node.href, title: node.textContent })));
    assert.equal(sourceLinks.length, 4, 'The industry source slide must show four distinct primary references.');
    for (const source of deck.industrySources) {
      assert(sourceLinks.some(link => link.url === source.url && link.title === source.title), `The industry source slide is missing ${source.title}.`);
      assert(normalized(await sourcePanel.innerText()).includes(normalized(source.note)), 'Source notes must preserve the period, population, and limits.');
    }
    assert.equal(await root.locator('svg.insight-chart').count(), 8, 'The overview and four cases must each contain sector charts.');
    for (const chart of await root.locator('svg.insight-chart').all()) {
      assert.equal(await chart.locator('animateMotion').count(), 0, 'Evidence plots must stay static while flow diagrams play.');
      assert(await chart.locator('title').textContent(), 'Every evidence chart needs an accessible title.');
      assert(await chart.locator('desc').textContent(), 'Every evidence chart needs an accessible description.');
      const sector = await chart.getAttribute('data-sector');
      assert(expectedSectors.includes(sector), `Evidence chart must identify its sector: ${sector}.`);
      if (sector === 'hospitality') {
        assert.equal(await chart.locator('.chart-dot').count(), 100, 'Hospitality plots one dot per percentage point.');
        assert.equal(await chart.locator('.chart-dot.is-filled').count(), 65, 'Exactly 65 of 100 hospitality dots must be filled.');
        const positions = await chart.locator('.chart-dot').evaluateAll(nodes => nodes.map(node => `${node.getAttribute('cx')},${node.getAttribute('cy')}`));
        assert.equal(new Set(positions).size, 100, 'Each hospitality percentage point needs a separate plotted dot.');
      } else if (sector === 'healthcare') {
        const bars = await chart.locator('rect[data-value]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.value)));
        assert.deepEqual(bars, [93, 79], 'Healthcare must show separate receive/integrate percentage bars.');
        const widths = await chart.locator('rect[data-value]').evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('width'))));
        assert(Math.abs(widths[0] / widths[1] - 93 / 79) < 0.001, 'Hospital bar lengths must encode the reported rates on the same scale.');
      } else if (sector === 'telecom') {
        const values = await chart.locator('[data-value]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.value)));
        assert.deepEqual(values, [100, 123], 'Telecom must use a 100-to-123 index rather than a fabricated traffic volume.');
        const widths = await chart.locator('rect[data-value]').evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('width'))));
        assert(Math.abs(widths[1] / widths[0] - 1.23) < 0.001, 'Telecom bar lengths must encode the source growth rate.');
      } else if (sector === 'utilities') {
        assert.equal(await chart.locator('.capacity-node').count(), 17, 'Utilities must plot seventeen 100 GW nodes.');
        assert((await chart.textContent()).includes('100 GW'), 'Utility node units must remain visible.');
      }
    }
    for (const sector of expectedSectors) {
      assert.equal(await root.locator(`svg.insight-chart[data-sector="${sector}"]`).count(), 2, 'Each sector appears in both the overview and its case.');
    }
  };
  const assertAtlasCaptions = async (page, figure) => {
    const svg = figure.locator('svg.motion-diagram');
    const stages = await svg.locator('.m-node[data-stage]').evaluateAll(nodes => nodes.map(node => ({ step: Number(node.dataset.step), title: node.dataset.stage, detail: node.dataset.stageDetail })));
    assert.equal(stages.length, 5, 'The atlas needs four industry stages and a common pattern.');
    for (let index = 0; index < expectedSectors.length; index += 1) {
      assert.equal(stages[index].step, index);
      assert(stages[index].title.toLowerCase().includes(industryById[expectedSectors[index]].shortName.toLowerCase()), 'Atlas stage titles must name the selected sector.');
      assert(stages[index].detail.length > 30, 'Each atlas stage needs a readable explanation.');
    }
    await assertHighlight(svg);
    await assertAllPaused(page);
  };
  const assertIndustryBridge = async page => {
    const bridgeSlide = deck.slides.find(slide => slide.type === 'industry-bridge');
    await goto(page, bridgeSlide.id);
    const bridge = page.locator('.slide:visible .industry-bridge');
    const selector = bridge.locator('.sector-selector button[data-sector]');
    assert.equal(await selector.count(), expectedSectors.length);
    const svg = bridge.locator('svg.motion-diagram');
    const snapshot = async () => ({
      sector: await bridge.getAttribute('data-sector'),
      evidence: normalized(await bridge.locator('.bridge-evidence').textContent()),
      output: normalized(await bridge.locator('.bridge-output').textContent()),
      owner: normalized(await bridge.locator('.bridge-owner').textContent())
    });
    const states = [];
    for (const [index, sector] of expectedSectors.entries()) {
      await bridge.locator(`.sector-selector button[data-sector="${sector}"]`).click();
      const state = await snapshot();
      assert.equal(state.sector, sector, 'Selecting a sector must update the bridge case.');
      assert.equal((await diagramState(svg)).step, index, 'Selecting a sector must update the atlas cursor.');
      assert.equal(await bridge.locator(`button[data-sector="${sector}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal(await bridge.locator('.sector-selector button[aria-pressed="true"]').count(), 1);
      assert.deepEqual(await bridge.locator('.bridge-evidence li').allTextContents(), industryById[sector].inputs, 'Bridge evidence must match the selected industry.');
      assert(state.output.includes(normalized(industryById[sector].output)), 'The bridge output must belong to the selected sector.');
      assert(state.owner.includes(normalized(industryById[sector].owner)), 'The bridge owner must belong to the selected sector.');
      assert.equal(normalized(await bridge.locator('.bridge-task').textContent()), normalized(industryById[sector].task));
      assert.equal(normalized(await bridge.locator('.bridge-test').textContent()), normalized(industryById[sector].test));
      states.push(state);
      await assertHighlight(svg);
    }
    assert.equal(new Set(states.map(state => state.evidence)).size, 4, 'All four bridge evidence cases must be distinct.');
    assert.equal(new Set(states.map(state => state.output)).size, 4, 'All four bridge outputs must be distinct.');
    assert.equal(new Set(states.map(state => state.owner)).size, 4, 'All four bridge owners must be distinct.');
    await bridge.locator('button[data-sector="telecom"]').click();
    await bridge.locator('.stage-next').click();
    assert.equal((await snapshot()).sector, 'utilities', 'Manual map stepping must synchronize the case selector.');
    assert.equal(await bridge.locator('button[data-sector="utilities"]').getAttribute('aria-pressed'), 'true');
    await bridge.locator('.stage-prev').click();
    assert.equal((await snapshot()).sector, 'telecom');
    for (let index = 0; index < 4; index += 1) await bridge.locator('.stage-next').click();
    assert.equal((await diagramState(svg)).step, 4);
    assert.match((await diagramState(svg)).title, /shared|common/i, 'The fifth atlas stage must explain the common pattern.');
    assert.equal((await snapshot()).sector, 'shared', 'The common stage must have its own labeled synthesis.');
    assert.equal(await bridge.locator('.sector-selector button[aria-pressed="true"]').count(), 0, 'The common stage must not masquerade as an industry case.');
    await page.screenshot({ path: '.validation/industry-bridge-desktop.png', fullPage: true });
    await assertAllPaused(page);
  };
  const assertMobileFlows = async (page, root = page, staticMode = false) => {
    for (const sector of expectedSectors) {
      const id = `${sector}-context`;
      if (!staticMode) await goto(page, id);
      const panel = root.locator(staticMode ? `#static-${id}` : `[data-slide="${id}"]`);
      const viewport = panel.locator('.diagram-viewport');
      const flow = viewport.locator('svg.motion-diagram');
      assert.equal(await viewport.getAttribute('role'), 'region', 'A horizontally scrollable flow needs a focusable region.');
      assert.equal(await viewport.getAttribute('tabindex'), '0');
      assert(await panel.locator('.diagram-scroll-hint').isVisible(), 'Mobile users need the diagram scroll instructions.');
      assert.match(await panel.locator('.diagram-scroll-hint').innerText(), /swipe.*arrow keys/i);
      const dimensions = await viewport.evaluate(node => ({
        client: node.clientWidth, scroll: node.scrollWidth, overflow: getComputedStyle(node).overflowX,
        svg: node.querySelector('svg').getBoundingClientRect().width
      }));
      assert(['auto', 'scroll'].includes(dimensions.overflow), 'The flow must scroll inside its own viewport.');
      assert(dimensions.svg >= 759 && dimensions.scroll > dimensions.client + 100, `Mobile flow labels must keep their readable size: ${JSON.stringify(dimensions)}.`);
      const originalUrl = page.url();
      await viewport.evaluate(node => { node.scrollLeft = 0; });
      await viewport.focus();
      assert(await viewport.evaluate(node => {
        const bounds = node.getBoundingClientRect();
        return node === document.activeElement && bounds.bottom > 0 && bounds.top < innerHeight;
      }), 'Focusing the mobile scroll region must put it on screen.');
      await page.keyboard.press('ArrowRight');
      if (staticMode) {
        // Native keyboard scrolling works without JavaScript. Poll from Node because
        // a page-side RAF wait cannot run in a JavaScript-disabled document.
        let scrolled = false;
        for (let attempt = 0; attempt < 5 && !scrolled; attempt += 1) {
          scrolled = await viewport.evaluate(node => node.scrollLeft > 0);
          if (!scrolled) await page.waitForTimeout(100);
        }
        assert(scrolled, `${sector} static flow must respond to native ArrowRight scrolling.`);
      } else {
        await page.waitForFunction(selector => document.querySelector(selector).scrollLeft > 0, `[data-slide="${id}"] .diagram-viewport`, { timeout: 2000 });
      }
      assert.equal(page.url(), originalUrl, 'Arrow keys focused on a diagram must scroll it without navigating the deck.');
      assert(await panel.isVisible(), 'Keyboard scrolling must retain the selected case.');
      await viewport.evaluate(node => { node.scrollLeft = node.scrollWidth; });
      const visibleDraft = await flow.locator('.m-node[data-step="3"]').evaluate(node => {
        const region = node.closest('.diagram-viewport').getBoundingClientRect();
        const draft = node.getBoundingClientRect();
        return draft.left >= region.left - 1 && draft.right <= region.right + 1;
      });
      assert(visibleDraft, 'The final Draft node must be reachable inside the mobile flow viewport.');
      await noOverflow(page);
    }
  };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await trackIntervals(context);
    const page = await context.newPage();
    watchErrors(page);
    await goto(page, deck.slides[0].id);
    assert.equal(await page.locator('.slide').count(), deck.slides.length);
    assert.equal(await page.locator('.slide:visible').count(), 1);
    assert.equal(await page.locator('.mechanism-figure').count(), 10);
    assert.equal(await page.locator('svg.motion-diagram').count(), 10);
    assert.equal(await page.locator('svg.insight-chart').count(), 8);
    assert((await page.locator('svg.motion-diagram animateMotion').count()) >= 10);
    assert(await page.getByRole('button', { name: 'Motion off', exact: true }).isDisabled(), 'Reduced motion must disable playback, including manual override.');
    await assertAllPaused(page);
    for (const svg of await page.locator('svg.motion-diagram').all()) {
      assert.equal(await dotsVisible(svg), 0, 'Reduced motion must hide every moving packet.');
      assert(await svg.evaluate(node => [...node.querySelectorAll('.m-node[data-stage]')].every(group => getComputedStyle(group).opacity === '1')), 'Every node must remain readable in reduced motion.');
      assert(await svg.evaluate(node => node.querySelector('title').textContent.length > 0 && node.querySelector('desc').textContent.length > 0), 'Each diagram needs an accessible title and description.');
    }
    const reducedCover = page.locator(coverSelector);
    await assertHighlight(reducedCover);
    await assertAtlasCaptions(page, page.locator('.slide:visible .mechanism-figure'));
    const inheritedColor = await reducedCover.evaluate(svg => {
      const host = svg.closest('.mechanism-figure');
      host.style.setProperty('--blue', '#123456');
      const color = getComputedStyle(svg.querySelector('marker path')).fill;
      host.style.removeProperty('--blue');
      return color;
    });
    assert.equal(inheritedColor, 'rgb(18, 52, 86)', 'SVG arrows must inherit the host CSS color variable.');
    await page.screenshot({ path: '.validation/cover-desktop.png', fullPage: true });
    await page.keyboard.press('ArrowRight');
    await page.locator(`[data-slide="${deck.slides[1].id}"]`).waitFor({ state: 'visible' });
    await page.screenshot({ path: '.validation/industry-overview-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Slides', exact: false }).click();
    assert.equal(await page.locator('.overview-card:visible').count(), deck.slides.length);
    await page.keyboard.press('Escape');
    assert(await page.locator('#overview').isHidden());
    for (const slide of deck.slides) { await goto(page, slide.id); await noOverflow(page); }
    await assertIndustryEvidence(page);
    await assertIndustryBridge(page);
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
    assertPdfPages(await page.pdf({ path: '.validation/industry-deck.pdf', printBackground: true, preferCSSPageSize: true }));
    await page.setViewportSize({ width: 390, height: 844 });
    for (const slide of deck.slides) { await goto(page, slide.id); await noOverflow(page); }
    await assertMobileFlows(page);
    await goto(page, deck.slides[1].id);
    await page.screenshot({ path: '.validation/industry-overview-mobile.png', fullPage: true });
    await goto(page, 'healthcare-context');
    await page.screenshot({ path: '.validation/healthcare-context-mobile.png', fullPage: true });
    await goto(page, deck.slides[0].id);
    await page.screenshot({ path: '.validation/cover-mobile.png', fullPage: true });
    await goto(page, 'upgrade-example');
    await page.locator('#upgrade-kind').selectOption('lost-exception');
    await page.getByRole('button', { name: 'Run illustrative checks' }).click();
    assert.equal(await page.locator('.demo-summary').getAttribute('data-outcome'), 'reject');
    await page.screenshot({ path: '.validation/upgrade-mobile.png', fullPage: true });
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.slide:visible').count(), deck.slides.length);
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
    assert.equal(await fallback.locator('.slide:visible').count(), deck.slides.length);
    assert.equal(await fallback.locator('svg.motion-diagram').count(), 10);
    assert.equal(await fallback.locator('svg.insight-chart').count(), 8);
    assert.equal(await fallback.locator('animateMotion').count(), 0, 'Static fallback SVGs must contain no native motion.');
    assert.equal(await fallback.locator('.slide h1, .slide h2').count(), deck.slides.length);
    for (const svg of await fallback.locator('svg.motion-diagram').all()) {
      assert(await svg.isVisible());
      assert(await svg.locator('title').textContent());
      assert(await svg.locator('desc').textContent());
      assert((await svg.locator('text').count()) > 0, 'Static diagrams must preserve their visible labels.');
    }
    await assertIndustryEvidence(fallback, true);
    await noOverflow(staticPage);
    assertPdfPages(await staticPage.pdf({ path: '.validation/industry-static-deck.pdf', printBackground: true, preferCSSPageSize: true }));
    await staticPage.setViewportSize({ width: 390, height: 844 });
    assert.equal(await fallback.locator('.slide:visible').count(), deck.slides.length);
    await noOverflow(staticPage);
    await assertMobileFlows(staticPage, fallback, true);
    assert.deepEqual(errors, []);
    console.log(`Browser checks: PASS (${deck.slides.length} desktop/mobile slides; 10 SVG stage diagrams; 8 evidence charts; 4 cited industry cases; synchronized sector bridge; readable mobile flow scrolling and keyboard navigation; native autoplay/pause/manual/resume; one stage interval; inactive/overview/25% visibility pausing; reduced motion; inherited CSS color; navigation; 4 upgrade scenarios; PDF/print; ${deck.slides.length}-slide JavaScript-disabled fallback; no page errors)`);
    console.log(`Checked URL: ${base}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
