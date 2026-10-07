const { chromium } = require(process.env.PREFRONTAL_PLAYWRIGHT_MODULE || 'playwright');
const { mkdir, readFile } = require('node:fs/promises');
const assert = require('node:assert/strict');

(async () => {
  const base = process.env.PREFRONTAL_TEST_URL || 'http://127.0.0.1:8893/';
  const deck = JSON.parse(await readFile('presentation-content.json', 'utf8'));
  assert.equal(deck.slides.length, 26, 'The product pitch contains four leadership slides, architecture, existing-stack integration and developer detail.');
  assert.equal(deck.slides[4].id, 'full-architecture', 'The complete architecture must be slide five.');
  assert.equal(deck.slides[4].type, 'architecture');
  assert(!deck.industries && !deck.industrySources && !deck.pitch.conference, 'The product pitch removes industry and conference narratives.');
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
  const assertBrand = async page => {
    const brand = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement), body = getComputedStyle(document.body);
      return { accent: root.getPropertyValue('--red').trim().toUpperCase(), paper: root.getPropertyValue('--paper').trim().toLowerCase(), background: body.backgroundColor, foreground: body.color, font: body.fontFamily };
    });
    assert.equal(brand.accent, '#EE001E', 'The presentation must use the supplied red brand accent.');
    assert(['#fff', '#ffffff'].includes(brand.paper), 'The paper token must remain white.');
    assert.equal(brand.background, 'rgb(255, 255, 255)', 'The presentation background must match the white reference surface.');
    assert.equal(brand.foreground, 'rgb(0, 0, 0)', 'The main brand foreground must be black.');
    assert.match(brand.font, /Arial/i, 'The presentation must use the agreed Arial sans-serif font stack.');
    const control = page.locator('.slide:visible .stage-next');
    assert(await control.isVisible(), 'The branded stage control must remain visible.');
    const shape = await control.evaluate(button => { const style = getComputedStyle(button); return { radius: parseFloat(style.borderTopLeftRadius), height: button.getBoundingClientRect().height }; });
    assert(shape.radius >= shape.height / 2 - 1, 'The stage control must retain a pill shape: ' + JSON.stringify(shape));
    await page.keyboard.press('Tab');
    await control.focus();
    const focus = await control.evaluate(button => { const style = getComputedStyle(button); return { visible: button.matches(':focus-visible'), color: style.outlineColor, width: parseFloat(style.outlineWidth), style: style.outlineStyle }; });
    assert(focus.visible && focus.color === 'rgb(238, 0, 30)' && focus.width >= 2 && focus.style !== 'none', 'Keyboard focus must visibly use the brand red: ' + JSON.stringify(focus));
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
        width: selected?.querySelector('rect') && getComputedStyle(selected.querySelector('rect')).strokeWidth,
        edges: [...node.querySelectorAll('.m-edge.is-current')].length,
        stage: selected?.dataset.stage, title: node.closest('.mechanism-figure').querySelector('.stage-title').textContent
      };
    });
    assert(state.matches, 'Node and edge highlights must follow the diagram cursor.');
    if (state.width) assert.equal(state.width, '3px', 'The current node must remain highlighted while paused.');
    else assert(state.edges > 0, 'A node-free feedback stage must visibly highlight its return connectors.');
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
  const pipelineId = 'product-overview';
  const pipelineSelector = `[data-slide="${pipelineId}"] svg.motion-diagram`;
  const architectureId = 'full-architecture';
  const architectureSelector = `[data-slide="${architectureId}"] svg.architecture-svg`;
  const architectureConnections = Object.fromEntries(deck.architecture.edges.map(edge => [edge.id, [edge.from, edge.to]]));
  const normalized = text => text.replace(/\s+/g, ' ').trim();
  const assertProductNodeBounds = async svg => {
    const boxes = await svg.evaluate(node => [...node.querySelectorAll('.m-node[data-stage]')].map(group => {
      const box = group.querySelector('rect').getBBox();
      return {
        stage: group.dataset.stage,
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        labels: [...group.querySelectorAll('text')].map(text => {
          const bounds = text.getBBox();
          return { text: text.textContent, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
        })
      };
    }));
    assert.equal(boxes.length, 5, 'The product map needs four visible objectives and their shared governed context stage.');
    const horizontalPadding = 8;
    const verticalPadding = 6;
    for (const stage of boxes) {
      assert(stage.labels.length >= 3, `Product stage ${stage.stage} must keep its heading and explanatory labels.`);
      for (const label of stage.labels) {
        assert(label.width > 0 && label.height > 0, `${stage.stage}: ${label.text} must render a measurable label.`);
        assert(label.x >= stage.box.x + horizontalPadding - 0.5 && label.x + label.width <= stage.box.x + stage.box.width - horizontalPadding + 0.5,
          `Product label must fit inside its node with horizontal padding: ${JSON.stringify({ stage: stage.stage, label, box: stage.box })}`);
        assert(label.y >= stage.box.y + verticalPadding - 0.5 && label.y + label.height <= stage.box.y + stage.box.height - verticalPadding + 0.5,
          `Product label must fit inside its node with vertical padding: ${JSON.stringify({ stage: stage.stage, label, box: stage.box })}`);
      }
    }
  };
  const assertProductFlowNodeBounds = async (svg, flow) => {
    const boxes = await svg.evaluate(node => [...node.querySelectorAll('[data-node]')].map(group => {
      const bounds = group.querySelector('rect').getBBox();
      return { id: group.dataset.node, box: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, labels: [...group.querySelectorAll('text')].map(text => { const b = text.getBBox(); return { text: text.textContent, x: b.x, y: b.y, width: b.width, height: b.height }; }) };
    }));
    assert.equal(boxes.length, 4, 'Each product flow needs four readable nodes.');
    for (const node of boxes) {
      const expected = flow.nodes.find(item => item.id === node.id);
      assert(expected, node.id + ' must belong to its declared product flow.');
      assert.deepEqual(node.labels.map(item => item.text), [expected.title, ...expected.lines], 'The flow must preserve every visible title and explanation.');
      for (const label of node.labels) {
        assert(label.width > 0 && label.height > 0);
        assert(label.x >= node.box.x + 5 - 0.5 && label.x + label.width <= node.box.x + node.box.width - 5 + 0.5 && label.y >= node.box.y + 4 - 0.5 && label.y + label.height <= node.box.y + node.box.height - 4 + 0.5, 'Product flow labels must fit inside their node: ' + JSON.stringify({ node: node.id, label, box: node.box }));
      }
    }
  };
  const expectedLenses = ['cost', 'performance', 'accuracy', 'trust'];
  const resultKeys = ['baseline', 'candidate', 'difference', 'yearOne', 'baselineUnit', 'candidateUnit'];
  const assumptionKeys = Object.keys(deck.pitch.businessCase.defaults);
  const slideForType = type => deck.slides.find(slide => slide.type === type);
  const assertPitchNarrative = async (root, staticMode = false) => {
    const panelForId = async id => {
      if (!staticMode) await goto(root, id);
      const panel = root.locator(staticMode ? '#static-' + id : '[data-slide="' + id + '"]');
      assert(await panel.isVisible(), id + ' must have a readable product story.');
      return panel;
    };
    const opening = await panelForId('opening-thesis');
    assert((await opening.innerText()).includes(deck.pitch.productName), 'The cover must identify the proposed product.');
    assert.match(normalized(await opening.innerText()), /concept|proposed|pilot/i, 'The cover must state product maturity.');
    assert.equal(await root.locator('.industry-case,.industry-overview-grid,.conference-insights').count(), 0, 'The new pitch must remove the previous sector and conference material.');
    for (const id of ['fragmented-context', 'product-overview', 'investment-case']) {
      const panel = await panelForId(id);
      assert((await panel.locator('h2').innerText()).trim().length > 0);
      assert((await panel.locator('.lead').innerText()).trim().length > 20);
      if (!staticMode) await root.screenshot({ path: '.validation/architecture-' + id + '-desktop.png', fullPage: true });
    }
    const investment = await panelForId('investment-case');
    assert.match(await investment.innerText(), /cost|spend|invest|overhead|budget/i, 'Leadership needs the economic reason to fund the architecture.');
    assert.match(await investment.innerText(), /illustrative|assum|unmeasured|not.{0,40}measur/i, 'The investment case must distinguish assumptions from measured savings.');
    const hurdleValues = { attempts: 1250, monthlyRequired: 1000 + 5000 / 12, perAttempt: (1000 + 5000 / 12) / 1250, handlingMinutes: (1000 + 5000 / 12) / 1250 };
    for (const [key, expected] of Object.entries(hurdleValues)) {
      const value = investment.locator('[data-hurdle="' + key + '"]');
      assert.equal(await value.count(), 1, 'Leadership must see the ' + key + ' economic hurdle.');
      assert(Math.abs(Number(await value.getAttribute('data-value')) - expected) < 0.000001, key + ' must use the complete setup and recurring overhead assumptions.');
    }
    const stack = await panelForId('existing-stack');
    const stackText = normalized(await stack.innerText());
    for (const term of [/Looker/i, /LookML/i, /Zenlytics/i, /custom app/i]) assert.match(stackText, term, 'The visible stack story must name each existing analytics component.');
    assert.match(stackText, /existing|current|reuse/i, 'The stack slide must explain reuse of the current investment.');
    assert.match(stackText, /native.{0,35}(?:query|execution)|(?:query|execution).{0,35}native/i, 'The visible integration story must preserve native query execution.');
    assert.match(stackText, /adapter/i, 'The integration story must show the adapter boundary.');
    assert.match(stackText, /to verify|must verify|verify.{0,35}(?:adapter|contract|permission)|(?:adapter|contract|permission).{0,35}verif/i, 'The integration must not imply that adapter contracts and permissions are already qualified.');
    const submission = await panelForId('submission-template');
    assert.equal(await submission.locator('table').count(), 1, 'Developers need a single tabular submission contract.');
    assert((await submission.locator('th').count()) >= 3, 'The submission contract must explain fields, examples and validation.');
    const submissionText = normalized(await submission.innerText());
    assert.match(submissionText, /source|evidence/i);
    assert.match(submissionText, /valid|review|scope/i);
    const contract = await panelForId('context-contract');
    const mappingText = submissionText + ' ' + normalized(await contract.innerText());
    for (const term of [/LookML/i, /model/i, /explore/i, /view/i, /measure/i, /Git.{0,25}(?:revision|commit)|(?:revision|commit).{0,25}Git/i]) assert.match(mappingText, term, 'The visible context contract must preserve versioned LookML source mapping.');
    const costDiscipline = await panelForId('cost-discipline');
    const disciplineText = normalized(await costDiscipline.innerText());
    for (const term of [/code|SQL/i, /context/i, /cach/i, /valid|fresh|version/i, /retr(?:y|ies)/i]) assert.match(disciplineText, term, 'The cost discipline slide must retain deterministic methods, context limits, valid caching and retry limits.');
    assert.match(disciplineText, /certified quer.{0,25}unchanged/i, 'Visible cost controls must preserve certified queries.');
    assert.match(disciplineText, /review.{0,30}expert drafts.{0,30}reuse/i, 'The visible cost controls must require review before reusing expert drafts.');
    const router = await panelForId('bounded-decision-router');
    const routerText = normalized(await router.innerText());
    for (const term of [/certified query references/i, /native execution/i, /access checks/i, /expert drafts/i, /review/i]) assert.match(routerText, term, 'The visible route must distinguish permission-checked certified references from expert drafts that require review.');
    const costModel = await panelForId('value-assumptions');
    const completeCostText = disciplineText + ' ' + normalized(await costModel.innerText());
    for (const term of [/warehouse|BigQuery/i, /seat|licen[cs]e/i, /human|review/i, /existing|allocated/i, /incremental/i]) assert.match(completeCostText, term, 'The visible cost case must distinguish complete operating costs and existing versus incremental licensing.');
    const plan = await panelForId('plan-alignment');
    const planText = normalized(await plan.innerText());
    assert.match(planText, /seven|7.{0,15}stage/i, 'The visible proposal must align with the seven-stage delivery journey.');
    for (const stage of ['Intake/Vetting', 'Product Requirements', 'Product Design', 'Development', 'Testing', 'Launch', 'Maintenance']) {
      assert(planText.toLowerCase().includes(stage.toLowerCase()), 'The visible proposal must preserve the supplied delivery stage: ' + stage + '.');
    }
    for (const term of [/owner/i, /review|govern/i, /pilot/i, /approv|gate/i]) assert.match(planText, term, 'The visible plan must explain ownership, governance and pilot approval gates.');
    const ste = await panelForId('meaning-preserving-ste');
    assert.match(await ste.innerText(), /STE-inspired|inspired by/i, 'The deck must not claim unchecked STE compliance.');
    assert.match(await ste.innerText(), /dispute|exception/i, 'The rewriting example must preserve exceptions.');
    const boundaries = await panelForId('evidence-boundary');
    for (const state of ['Available now', 'Designed', 'To implement', 'To qualify']) assert((await boundaries.innerText()).includes(state), 'Readiness must distinguish ' + state + '.');
    const proof = await panelForId('pilot-acceptance');
    assert.equal(await proof.locator('.proof-card').count(), expectedLenses.length);
    for (const item of deck.pitch.scorecard) {
      const card = proof.locator('.proof-card[data-lens="' + item.id + '"]');
      assert.equal(await card.count(), 1);
      const text = normalized(await card.innerText()).toLowerCase();
      for (const key of ['name', 'metric', 'trial', 'decision']) assert(text.includes(normalized(item[key]).toLowerCase()), item.id + ' proof must preserve ' + key + '.');
    }
    assert.match(await proof.innerText(), /pilot|not.{0,30}measured|unmeasured/i, 'Planned pilot evidence must not read as achieved product benchmarks.');
    if (!staticMode) await root.screenshot({ path: '.validation/architecture-pilot-proof-desktop.png', fullPage: true });
    for (const slide of deck.slides.filter(item => item.type === 'product-flow')) {
      const panel = await panelForId(slide.id);
      const svg = panel.locator('svg.product-flow-svg');
      assert.equal(await svg.count(), 1, slide.id + ' needs its explanatory flow.');
      await assertProductFlowNodeBounds(svg, slide.flow);
      const stages = await svg.locator('.m-node[data-stage]').evaluateAll(nodes => nodes.map(node => ({ title: node.dataset.stage, detail: node.dataset.stageDetail })));
      assert.equal(stages.length, 4);
      for (let index = 0; index < stages.length; index += 1) {
        assert.equal(stages[index].title, slide.flow.nodes[index].title);
        assert.equal(stages[index].detail, slide.flow.nodes[index].detail);
      }
    }
  };
  const assertCostResults = async (model, expected, outcome, staticMode = false) => {
    if (!staticMode) assert.equal(await model.getAttribute('data-state'), 'illustrative');
    const results = model.locator('.business-case-results');
    assert(await results.isVisible(), 'A valid cost scenario must show its complete results.');
    assert.deepEqual((await results.locator('[data-result]').evaluateAll(nodes => nodes.map(node => node.dataset.result))).sort(), [...resultKeys].sort(), 'The model must show exactly six named results.');
    if (outcome) assert.equal(await results.getAttribute('data-outcome'), outcome, 'The cost result must distinguish lower and higher candidate costs.');
    for (const [key, value] of Object.entries(expected)) {
      const result = results.locator(`[data-result="${key}"]`);
      assert.equal(await result.count(), 1, `The cost model needs its ${key} result.`);
      const raw = await result.getAttribute('data-value');
      assert(raw !== null && raw.trim().length > 0, `${key} must expose its unrounded numeric result.`);
      const actual = Number(raw);
      assert(Number.isFinite(actual), `${key} must be a finite number.`);
      assert(Math.abs(actual - value) < 0.000001, `${key}: expected ${value}, received ${actual}.`);
      const readable = await result.innerText();
      const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: deck.pitch.businessCase.currency, maximumFractionDigits: 2 }).format(value);
      assert(readable.includes(formatted), `${key} must display its checked numeric result as ${formatted}.`);
    }
    const note = model.locator('.business-case-note');
    assert(await note.isVisible(), 'The illustrative model must show its assumption warning.');
    assert.match(await note.innerText(), /illustrative|assumption/i);
    assert.match(await note.innerText(), /not.{0,40}measur|unmeasured|invented/i, 'The scenario must not imply measured product savings.');
  };
  const assertBusinessCase = async (page, staticMode = false, root = page) => {
    const slide = slideForType('pitch-calculator');
    if (!staticMode) await goto(page, slide.id);
    const panel = root.locator(staticMode ? `#static-${slide.id}` : `[data-slide="${slide.id}"]`);
    const model = panel.locator(staticMode ? '.business-case-static' : '.business-case');
    assert.equal(await model.count(), 1, 'The buyer story needs one cost model.');
    const defaultResults = { baseline: 6500, candidate: 7500, difference: -1000, yearOne: -17000, baselineUnit: 6.5, candidateUnit: 7.5 };
    await assertCostResults(model, defaultResults, 'higher-cost', staticMode);
    assert.match(await model.innerText(), /accepted.{0,30}task|task.{0,30}accepted/i, 'The cost model must compare a common accepted-task target.');
    assert.match(await model.innerText(), /USD|\$/, 'The cost model must label its currency.');
    const modelText = normalized(await model.innerText());
    for (const key of ['definition', 'limitation', 'costScope']) assert(modelText.includes(normalized(deck.pitch.businessCase[key])), `The cost model must retain its ${key}.`);
    if (staticMode) {
      assert.equal(await model.locator('input').count(), 0, 'The JavaScript-disabled cost model must read as a fixed worked example.');
      for (const key of assumptionKeys) {
        const assumption = model.locator(`[data-assumption="${key}"]`);
        assert.equal(await assumption.count(), 1, `The static example must preserve ${key}.`);
        const raw = await assumption.getAttribute('data-value');
        assert(raw !== null && raw.trim().length > 0, `The static ${key} must expose its stated assumption.`);
        assert.equal(Number(raw), deck.pitch.businessCase.defaults[key], `The static ${key} must match the illustrative defaults.`);
      }
      assert.match(await model.innerText(), /attempts|acceptance/i, 'The static example must retain the acceptance adjustment.');
      assert.match(await model.innerText(), /setup/i, 'The static example must retain one-time setup cost.');
      assert(modelText.includes(normalized(deck.pitch.businessCase.formula)), 'The static worked example must preserve the complete formula.');
      return;
    }
    for (const key of assumptionKeys) {
      const field = model.locator(`#bc-${key}`);
      assert.equal(await field.getAttribute('type'), 'number');
      assert.equal(Number(await field.inputValue()), deck.pitch.businessCase.defaults[key]);
      assert(await field.evaluate(input => input.labels.length > 0 && [...input.labels].every(label => label.textContent.trim().length > 0)), `Cost input ${key} needs an accessible label.`);
    }
    const setInputs = async values => {
      for (const [key, value] of Object.entries(values)) await model.locator(`#bc-${key}`).fill(String(value));
    };
    // The same accepted-task target requires 2,000 candidate attempts at 50%
    // acceptance. This independently checks the model's quality adjustment.
    await setInputs({ candidateMinutes: 2 });
    await assertCostResults(model, { baseline: 6500, candidate: 5000, difference: 1500, yearOne: 13000, baselineUnit: 6.5, candidateUnit: 5 }, 'lower-cost');
    await setInputs({ candidateMinutes: 4, candidateAcceptance: 50 });
    await assertCostResults(model, { baseline: 6500, candidate: 11400, difference: -4900, yearOne: -63800, baselineUnit: 6.5, candidateUnit: 11.4 }, 'higher-cost');
    await setInputs({ candidateCost: 2, candidateMinutes: 8 });
    await assertCostResults(model, { baseline: 6500, candidate: 21000, difference: -14500, yearOne: -179000, baselineUnit: 6.5, candidateUnit: 21 }, 'higher-cost');
    assert.match(await model.innerText(), /higher|more expensive|increase/i, 'A negative case must state that the candidate costs more.');
    await setInputs({ target: 2000, hourly: 0, setup: 0, baselineCost: 2, candidateCost: 1, baselineMinutes: 0, candidateMinutes: 0, baselineAcceptance: 100, candidateAcceptance: 100, baselineFixed: 0, candidateFixed: 0 });
    await assertCostResults(model, { baseline: 4000, candidate: 2000, difference: 2000, yearOne: 24000, baselineUnit: 2, candidateUnit: 1 }, 'lower-cost');
    const invalidInputs = [['target', ''], ['target', '0'], ['hourly', '-1'], ['candidateCost', '-0.1'], ['setup', '-1'], ['baselineAcceptance', '0'], ['candidateAcceptance', '101'], ['target', '1e308']];
    for (const [key, value] of invalidInputs) {
      const field = model.locator(`#bc-${key}`);
      const before = await field.inputValue();
      await field.fill(value);
      assert.equal(await model.getAttribute('data-state'), 'invalid', `${key}=${value || 'empty'} must not produce a cost claim.`);
      const warning = model.locator('.business-case-error');
      assert(await warning.isVisible());
      assert.equal(await warning.getAttribute('role'), 'alert');
      assert((await warning.innerText()).trim().length > 0);
      assert(await model.locator('.business-case-results').isHidden(), 'Invalid inputs must hide stale positive results.');
      await field.fill(before);
      await assertCostResults(model, { baseline: 4000, candidate: 2000, difference: 2000, yearOne: 24000, baselineUnit: 2, candidateUnit: 1 }, 'lower-cost');
    }
    await setInputs(deck.pitch.businessCase.defaults);
    await assertCostResults(model, defaultResults, 'higher-cost');
    await page.screenshot({ path: '.validation/architecture-pitch-calculator-desktop.png', fullPage: true });
  };
  const assertArchitectureNodeBounds = async svg => {
    const geometry = await svg.evaluate(node => ({
      view: { x: node.viewBox.baseVal.x, y: node.viewBox.baseVal.y, width: node.viewBox.baseVal.width, height: node.viewBox.baseVal.height },
      labels: [...node.querySelectorAll('text')].map(text => {
        const bounds = text.getBBox();
        return { text: text.textContent, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      }),
      boxes: [...node.querySelectorAll('[data-node]')].map(group => {
        const box = group.querySelector('rect').getBBox();
        return {
          id: group.dataset.node,
          box: { x: box.x, y: box.y, width: box.width, height: box.height },
          labels: [...group.querySelectorAll('text')].map(text => {
            const bounds = text.getBBox();
            return { text: text.textContent, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
          })
        };
      })
    }));
    assert.equal(geometry.boxes.length, 12, 'The complete product workflow needs twelve readable nodes.');
    for (const label of geometry.labels) {
      assert(label.x >= geometry.view.x - 0.5 && label.y >= geometry.view.y - 0.5 && label.x + label.width <= geometry.view.x + geometry.view.width + 0.5 && label.y + label.height <= geometry.view.y + geometry.view.height + 0.5,
        `Every architecture label, including policy and review, must remain inside the SVG: ${JSON.stringify(label)}.`);
    }
    for (let index = 0; index < geometry.boxes.length; index += 1) {
      for (const next of geometry.boxes.slice(index + 1)) {
        const first = geometry.boxes[index];
        const overlapWidth = Math.min(first.box.x + first.box.width, next.box.x + next.box.width) - Math.max(first.box.x, next.box.x);
        const overlapHeight = Math.min(first.box.y + first.box.height, next.box.y + next.box.height) - Math.max(first.box.y, next.box.y);
        assert(overlapWidth <= 0 || overlapHeight <= 0, `Architecture nodes ${first.id} and ${next.id} must not obscure one another.`);
      }
    }
    for (const node of geometry.boxes) {
      const expected = deck.architecture.nodes.find(candidate => candidate.id === node.id);
      assert(expected, `The architecture must use a declared node: ${node.id}.`);
      assert.equal(node.labels.length, expected.lines.length + 1, `${node.id} must retain its title and all details.`);
      assert(node.box.x >= geometry.view.x && node.box.y >= geometry.view.y && node.box.x + node.box.width <= geometry.view.x + geometry.view.width && node.box.y + node.box.height <= geometry.view.y + geometry.view.height, `${node.id} must remain within the SVG canvas.`);
      for (const label of node.labels) {
        assert(label.width > 0 && label.height > 0, `${node.id}: ${label.text} must render a measurable label.`);
        assert(label.x >= node.box.x + 5 - 0.5 && label.x + label.width <= node.box.x + node.box.width - 5 + 0.5,
          `Architecture label must fit inside its node with horizontal padding: ${JSON.stringify({ id: node.id, label, box: node.box })}`);
        assert(label.y >= node.box.y + 4 - 0.5 && label.y + label.height <= node.box.y + node.box.height - 4 + 0.5,
          `Architecture label must fit inside its node with vertical padding: ${JSON.stringify({ id: node.id, label, box: node.box })}`);
      }
      for (let index = 1; index < node.labels.length; index += 1) {
        const before = node.labels[index - 1], label = node.labels[index];
        assert(before.y + before.height <= label.y + 0.5, `Architecture labels must not overlap inside ${node.id}: ${JSON.stringify({ before, label })}.`);
      }
    }
  };
  const assertArchitecture = async (page, root = page, staticMode = false) => {
    if (!staticMode) await goto(page, architectureId);
    const panel = root.locator(staticMode ? `#static-${architectureId}` : `[data-slide="${architectureId}"]`);
    assert(await panel.isVisible(), 'The dedicated architecture must be readable.');
    const svg = panel.locator('svg.architecture-svg');
    assert.equal(await svg.count(), 1, 'One slide must contain the entire workflow in one SVG.');
    assert.equal(await root.locator('svg.architecture-svg').count(), 1, 'The architecture must not become multiple dedicated slides.');
    const text = normalized([await panel.innerText(), await svg.textContent()].join(' '));
    for (const node of deck.architecture.nodes) {
      assert.equal(await svg.locator(`[data-node="${node.id}"]`).count(), 1, `The architecture must show ${node.id}.`);
      for (const value of [node.title, ...node.lines]) assert(text.includes(normalized(value)), `Architecture node ${node.id} must preserve ${value}.`);
    }
    const policy = svg.locator('[data-policy="external"]');
    assert.equal(await policy.count(), 1, 'The model must not own its policy authority.');
    for (const value of [deck.architecture.policy.title, deck.architecture.policy.detail]) assert(normalized(await policy.textContent()).includes(normalized(value)));
    assert(await policy.evaluate(node => !node.closest('.m-stage')), 'Policy must remain outside the highlighted execution stages.');
    const review = svg.locator('[data-review="owner"]');
    assert.equal(await review.count(), 1, 'The workflow must keep a visible human owner review boundary.');
    assert(normalized(await review.textContent()).includes(normalized(deck.architecture.review)));
    assert(text.includes(normalized(deck.architecture.legend)), 'The one-slide diagram must explain approved processing, review returns and the ID permission boundary.');
    assert.match(text, /proposed|proposal|not implemented/i, 'The architecture must preserve the product maturity boundary.');
    const connections = await svg.evaluate(node => [...node.querySelectorAll('[data-edge]')].map(group => {
      const path = group.querySelector('path');
      const length = path.getTotalLength();
      const start = path.getPointAtLength(0), end = path.getPointAtLength(length);
      const motion = group.querySelector('animateMotion mpath');
      return { id: group.dataset.edge, pathId: path.id, length, arrow: path.getAttribute('marker-end'), start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y }, reference: motion?.getAttribute('href') };
    }));
    assert.deepEqual(connections.map(edge => edge.id).sort(), Object.keys(architectureConnections).sort(), 'All branches and the governed feedback path must remain visible.');
    assert.equal(new Set(connections.map(edge => edge.pathId)).size, connections.length, 'Each visible connector must have its own unique motion path.');
    const nearNode = (point, id) => {
      const node = deck.architecture.nodes.find(candidate => candidate.id === id);
      return point.x >= node.x - 12 && point.x <= node.x + node.width + 12 && point.y >= node.y - 12 && point.y <= node.y + node.height + 12;
    };
    for (const edge of connections) {
      assert(edge.length > 0 && edge.arrow?.startsWith('url('), `${edge.id} must be a visible directed connection.`);
      const [source, target] = architectureConnections[edge.id];
      assert(nearNode(edge.start, source) && nearNode(edge.end, target), `${edge.id} must connect the intended ${source} and ${target} nodes: ${JSON.stringify(edge)}.`);
      if (!staticMode) assert.equal(edge.reference, `#${edge.pathId}`, `${edge.id} motion must follow the same path as its visible arrow.`);
    }
    await assertArchitectureNodeBounds(svg);
    const stages = await svg.locator('.m-node[data-stage]').evaluateAll(nodes => nodes.map(node => ({ step: Number(node.dataset.step), title: node.dataset.stage, detail: node.dataset.stageDetail })));
    assert.equal(stages.length, 5, 'The full architecture needs five explanatory stages.');
    for (let index = 0; index < stages.length; index += 1) assert.deepEqual(stages[index], { step: index, title: deck.architecture.stages[index].title, detail: deck.architecture.stages[index].detail });
    if (!staticMode) {
      const figure = panel.locator('.mechanism-figure');
      for (let index = 0; index < stages.length; index += 1) {
        assert.equal((await diagramState(svg)).step, index);
        assert.equal(await figure.locator('.stage-title').innerText(), deck.architecture.stages[index].title);
        assert.equal(await figure.locator('.stage-detail').innerText(), deck.architecture.stages[index].detail);
        const bounds = await panel.evaluate(node => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom, viewport: innerHeight }));
        assert(bounds.top >= -1 && bounds.bottom <= bounds.viewport + 1, `The complete architecture, stage controls and note must fit the desktop presentation viewport at stage ${index + 1}: ${JSON.stringify(bounds)}.`);
        await assertHighlight(svg);
        await figure.locator('.stage-next').click();
      }
      assert.equal((await diagramState(svg)).step, 0, 'Advancing the last architecture stage must wrap to the first.');
      await figure.locator('.stage-prev').click();
      assert.equal((await diagramState(svg)).step, 4, 'Previous stage must reach feedback and corrections from the beginning.');
      await figure.locator('.stage-next').click();
      await assertAllPaused(page);
    }
    if (staticMode) await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.validation/architecture-full-${staticMode ? 'static-' : ''}desktop.png`, fullPage: !staticMode });
  };
  const assertMobileArchitecture = async (page, root = page, staticMode = false) => {
    if (!staticMode) await goto(page, architectureId);
    const panel = root.locator(staticMode ? `#static-${architectureId}` : `[data-slide="${architectureId}"]`);
    const viewport = panel.locator('.architecture-viewport');
    const svg = viewport.locator('svg.architecture-svg');
    assert.equal(await viewport.getAttribute('role'), 'region', 'The full architecture needs a focusable scroll region on small screens.');
    assert.equal(await viewport.getAttribute('tabindex'), '0');
    assert(await panel.locator('.diagram-scroll-hint').isVisible());
    assert.match(await panel.locator('.diagram-scroll-hint').innerText(), /swipe.*arrow keys/i);
    const dimensions = await viewport.evaluate(node => ({ client: node.clientWidth, scroll: node.scrollWidth, overflow: getComputedStyle(node).overflowX, svg: node.querySelector('svg').getBoundingClientRect().width }));
    assert(['auto', 'scroll'].includes(dimensions.overflow) && dimensions.svg >= 1259 && dimensions.scroll > dimensions.client + 100, `Mobile architecture labels must retain readable size inside the slide: ${JSON.stringify(dimensions)}.`);
    await assertArchitectureNodeBounds(svg);
    await viewport.evaluate(node => { node.scrollLeft = 0; });
    await viewport.focus();
    const originalUrl = page.url();
    await page.keyboard.press('ArrowRight');
    // Native scrolling also runs in the JavaScript-disabled presentation.
    // Poll from Node so this check does not depend on document JavaScript.
    let scrolled = false;
    for (let attempt = 0; attempt < 5 && !scrolled; attempt += 1) {
      scrolled = await viewport.evaluate(node => node.scrollLeft > 0);
      if (!scrolled) await page.waitForTimeout(100);
    }
    assert(scrolled, 'The complete mobile architecture must respond to native ArrowRight scrolling.');
    assert.equal(page.url(), originalUrl, 'Architecture keyboard scrolling must not navigate the deck.');
    await viewport.evaluate(node => { node.scrollLeft = node.scrollWidth; });
    const rightmost = await svg.locator('[data-node="consumers"]').evaluate(node => {
      const region = node.closest('.architecture-viewport').getBoundingClientRect(), box = node.getBoundingClientRect();
      return box.left >= region.left - 1 && box.right <= region.right + 1;
    });
    assert(rightmost, 'The consumer delivery node must be reachable at the right of the mobile architecture.');
    await noOverflow(page);
    await viewport.evaluate(node => { node.scrollLeft = 0; });
    await viewport.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.validation/architecture-full-${staticMode ? 'static-' : ''}mobile.png`, fullPage: !staticMode });
  };
  const assertProductValueCaptions = async (page, figure) => {
    const svg = figure.locator('svg.motion-diagram');
    const stages = await svg.locator('.m-node[data-stage]').evaluateAll(nodes => nodes.map(node => ({ step: Number(node.dataset.step), title: node.dataset.stage, detail: node.dataset.stageDetail })));
    assert.equal(stages.length, 5, 'The product value map needs four buyer objectives and their common context foundation.');
    const dimensions = [/cost/i, /performance|latency|speed/i, /accuracy/i, /trust/i];
    for (let index = 0; index < dimensions.length; index += 1) {
      assert.equal(stages[index].step, index);
      assert.match(stages[index].title, dimensions[index], 'Product stages must explain cost, performance, accuracy, and trust in that order.');
      assert(stages[index].detail.length > 30, 'Each product stage needs a readable explanation.');
    }
    assert.equal(stages[4].step, 4);
    assert.match(stages[4].title, /Prefrontal.*governed context/i, 'The shared fifth stage must name the product foundation.');
    assert.match(stages[4].detail, /proposed.*pilot/i, 'The context foundation must preserve the proposed-product and measured-pilot boundary.');
    await assertHighlight(svg);
    await assertAllPaused(page);
  };
  const assertMobileFlows = async (page, root = page, staticMode = false) => {
    for (const slide of deck.slides.filter(item => item.type === 'product-flow')) {
      const id = slide.id;
      if (!staticMode) await goto(page, id);
      const panel = root.locator(staticMode ? `#static-${id}` : `[data-slide="${id}"]`);
      const viewport = panel.locator('.diagram-viewport');
      const flow = viewport.locator('svg.motion-diagram');
      await assertProductFlowNodeBounds(flow, slide.flow);
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
        assert(scrolled, `${id} static flow must respond to native ArrowRight scrolling.`);
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
      assert(visibleDraft, 'The final product stage must be reachable inside the mobile flow viewport.');
      await noOverflow(page);
    }
  };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await trackIntervals(context);
    const page = await context.newPage();
    watchErrors(page);
    await goto(page, deck.slides[0].id);
    await assertBrand(page);
    assert.equal(await page.locator('.slide').count(), deck.slides.length);
    assert.equal(await page.locator('.slide:visible').count(), 1);
    assert.equal(await page.locator('.mechanism-figure').count(), 9);
    assert.equal(await page.locator('svg.motion-diagram').count(), 9);
    assert.equal(await page.locator('svg.product-flow-svg').count(), 5, 'The dynamic deck must retain all five explanatory product flows.');
    assert.equal(await page.locator('svg.insight-chart').count(), 0);
    assert((await page.locator('svg.motion-diagram animateMotion').count()) >= 9);
    assert(await page.getByRole('button', { name: 'Motion off', exact: true }).isDisabled(), 'Reduced motion must disable playback, including manual override.');
    await assertAllPaused(page);
    for (const svg of await page.locator('svg.motion-diagram').all()) {
      assert.equal(await dotsVisible(svg), 0, 'Reduced motion must hide every moving packet.');
      assert(await svg.evaluate(node => [...node.querySelectorAll('.m-node[data-stage]')].every(group => getComputedStyle(group).opacity === '1')), 'Every node must remain readable in reduced motion.');
      assert(await svg.evaluate(node => node.querySelector('title').textContent.length > 0 && node.querySelector('desc').textContent.length > 0), 'Each diagram needs an accessible title and description.');
    }
    const reducedCover = page.locator(coverSelector);
    await assertHighlight(reducedCover);
    await assertProductValueCaptions(page, page.locator('.slide:visible .mechanism-figure'));
    await assertProductNodeBounds(reducedCover);
    const inheritedColor = await reducedCover.evaluate(svg => {
      const host = svg.closest('.mechanism-figure');
      host.style.setProperty('--blue', '#123456');
      const color = getComputedStyle(svg.querySelector('marker path')).fill;
      host.style.removeProperty('--blue');
      return color;
    });
    assert.equal(inheritedColor, 'rgb(18, 52, 86)', 'SVG arrows must inherit the host CSS color variable.');
    await page.screenshot({ path: '.validation/architecture-cover-desktop.png', fullPage: true });
    await page.keyboard.press('ArrowRight');
    await page.locator(`[data-slide="${deck.slides[1].id}"]`).waitFor({ state: 'visible' });
    await page.screenshot({ path: '.validation/architecture-buyer-problem-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Slides', exact: false }).click();
    assert.equal(await page.locator('.overview-card:visible').count(), deck.slides.length);
    await page.keyboard.press('Escape');
    assert(await page.locator('#overview').isHidden());
    for (const slide of deck.slides) { await goto(page, slide.id); await noOverflow(page); }
    await assertArchitecture(page);
    await assertPitchNarrative(page);
    await assertBusinessCase(page);
    await goto(page, 'human-review-routes');
    await page.screenshot({ path: '.validation/architecture-governance-desktop.png', fullPage: true });
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
    await page.screenshot({ path: '.validation/architecture-upgrade-desktop.png', fullPage: true });
    assertPdfPages(await page.pdf({ path: '.validation/architecture-deck.pdf', printBackground: true, preferCSSPageSize: true }));
    await page.setViewportSize({ width: 390, height: 844 });
    for (const slide of deck.slides) { await goto(page, slide.id); await noOverflow(page); }
    await assertMobileArchitecture(page);
    await goto(page, slideForType('pitch-calculator').id);
    await page.locator('#bc-candidateAcceptance').fill('50');
    await assertCostResults(page.locator('.slide:visible .business-case'), { baseline: 6500, candidate: 11400, difference: -4900, yearOne: -63800, baselineUnit: 6.5, candidateUnit: 11.4 }, 'higher-cost');
    await noOverflow(page);
    await page.screenshot({ path: '.validation/architecture-pitch-calculator-mobile.png', fullPage: true });
    await page.locator('#bc-candidateAcceptance').fill(String(deck.pitch.businessCase.defaults.candidateAcceptance));
    await assertMobileFlows(page);
    await goto(page, deck.slides[0].id);
    await assertProductNodeBounds(page.locator(coverSelector));
    await page.screenshot({ path: '.validation/architecture-cover-mobile.png', fullPage: true });
    await goto(page, 'upgrade-example');
    await page.locator('#upgrade-kind').selectOption('lost-exception');
    await page.getByRole('button', { name: 'Run illustrative checks' }).click();
    assert.equal(await page.locator('.demo-summary').getAttribute('data-outcome'), 'reject');
    await page.screenshot({ path: '.validation/architecture-upgrade-mobile.png', fullPage: true });
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
    await motionPage.locator('.nav-item').nth(4).click();
    await waitForMotion(motionPage, architectureSelector, true);
    const architectureSvg = motionPage.locator(architectureSelector);
    const architectureFirst = await diagramState(architectureSvg);
    await motionPage.waitForFunction(({ selector, step }) => Number(document.querySelector(selector).dataset.currentStep) !== step, { selector: architectureSelector, step: architectureFirst.step }, { timeout: 4000 });
    assert((await diagramState(architectureSvg)).time > architectureFirst.time, 'The full architecture must share native SVG autoplay.');
    assert((await dotsVisible(architectureSvg)) > 0, 'The highlighted architecture connection must show its traveling packet.');
    assert((await diagramState(pipeline)).paused, 'The architecture must pause the previous slide and keep one active diagram.');
    await assertHighlight(architectureSvg);
    await assertIntervals(motionPage, 1);
    await motionPage.locator('.slide:visible .stage-next').click();
    await waitForMotion(motionPage, architectureSelector, false);
    await assertHighlight(architectureSvg);
    await assertIntervals(motionPage, 0);
    await motionPage.getByRole('button', { name: 'Play motion', exact: true }).click();
    await waitForMotion(motionPage, architectureSelector, true);
    await motionPage.locator('.nav-item').nth(deck.slides.findIndex(slide => slide.id === pipelineId)).click();
    await waitForMotion(motionPage, pipelineSelector, true);
    assert((await diagramState(architectureSvg)).paused, 'Leaving the architecture slide must pause its native animation.');
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
    assert.equal(await fallback.locator('svg.motion-diagram').count(), 9);
    assert.equal(await fallback.locator('svg.product-flow-svg').count(), 5, 'The static deck must retain all five explanatory product flows.');
    assert.equal(await fallback.locator('svg.insight-chart').count(), 0);
    assert.equal(await fallback.locator('animateMotion').count(), 0, 'Static fallback SVGs must contain no native motion.');
    assert.equal(await fallback.locator('.slide h1, .slide h2').count(), deck.slides.length);
    for (const svg of await fallback.locator('svg.motion-diagram').all()) {
      assert(await svg.isVisible());
      assert(await svg.locator('title').textContent());
      assert(await svg.locator('desc').textContent());
      assert((await svg.locator('text').count()) > 0, 'Static diagrams must preserve their visible labels.');
    }
    await assertProductNodeBounds(fallback.locator(`#static-${deck.slides[0].id} svg.product-map`));
    await assertArchitecture(staticPage, fallback, true);
    await assertPitchNarrative(fallback, true);
    await assertBusinessCase(staticPage, true, fallback);
    await noOverflow(staticPage);
    assertPdfPages(await staticPage.pdf({ path: '.validation/architecture-static-deck.pdf', printBackground: true, preferCSSPageSize: true }));
    await staticPage.setViewportSize({ width: 390, height: 844 });
    assert.equal(await fallback.locator('.slide:visible').count(), deck.slides.length);
    await assertProductNodeBounds(fallback.locator(`#static-${deck.slides[0].id} svg.product-map`));
    await noOverflow(staticPage);
    await assertMobileArchitecture(staticPage, fallback, true);
    await assertMobileFlows(staticPage, fallback, true);
    assert.deepEqual(errors, []);
    console.log(`Browser checks: PASS (${deck.slides.length} desktop/mobile product slides; four leadership slides; full architecture on slide five with 12 contained nodes and ${deck.architecture.edges.length} directed paths; independent policy and human review; five manual architecture stages; five product-flow diagrams; existing-stack reuse, adapter verification and versioned LookML mapping; certified-query and reviewed-draft distinction; complete cost scope and seven-stage governance alignment; neutral overhead, positive and negative cost arithmetic, acceptance adjustment, eight invalid cases and recovery; four pilot dimensions; nine SVG diagrams; supplied white/black/red brand, Arial, pill controls and visible keyboard focus; mobile keyboard scrolling; native autoplay/pause/manual/resume and one active interval; inactive/overview/visibility pausing; reduced motion; inherited CSS color; navigation; four illustrative upgrade scenarios; PDF/print; full JavaScript-disabled fallback; no page errors)`);
    console.log(`Checked URL: ${base}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
