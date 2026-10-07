/* Local cost worksheet. The v7 reference supplies example assumptions, not measured results. */
(function (global) {
  "use strict";
  const ESC = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const CATEGORIES = [
    ["q", "Question"], ["ans", "Answer"], ["sys", "Instructions"],
    ["tools", "Tool list"], ["doc", "Documents and data"],
    ["hist", "Repeated history"], ["res", "Tool steps and results"],
    ["think", "Thinking"], ["retry", "Expected retries"]
  ];
  const ASSUMPTIONS = [
    ["qWords", "Question words", 5], ["sys", "Instruction tokens", 100],
    ["tools", "Tool definition tokens", 100], ["doc", "Document and data tokens", 100],
    ["turns", "Messages per task", 1], ["steps", "Calls per message", 1],
    ["res", "Tool result tokens per step", 100], ["stepOut", "Tool call output tokens", 50],
    ["think", "Thinking tokens per call", 100], ["ansWords", "Answer words", 10],
    ["retry", "Expected retry uplift (%)", 1], ["cache", "Eligible input cached (%)", 5]
  ];
  const FALLBACK = { id: "summary", name: "Summarize a document", plain: "Read a document. Answer one follow-up question.", unit: ["document", "documents"], model: "example", people: 20, perDay: 5, a: { qWords: 30, sys: 500, tools: 0, doc: 2667, turns: 2, steps: 1, res: 0, stepOut: 0, think: 1500, ansWords: 500, retry: 5, cache: 50 } };
  const MODEL = { id: "example", name: "Editable example", in: 3, cr: 0.3, out: 15, wr: 1.25, tok: 1 };
  const num = value => Math.round(value).toLocaleString("en-US");
  const money = value => "$" + (Math.abs(value) >= 100 ? value.toFixed(0) : Math.abs(value) >= 1 ? value.toFixed(2) : value.toFixed(4));
  const dec = value => Number(value.toFixed(4));
  const sessions = new WeakMap();
  let serial = 0;

  /* Tokenizer factors scale text-derived tokens once. Thinking is already a token budget. */
  function calculate(assumptions, options) {
    if (assumptions && assumptions.a) {
      options = Object.assign({}, assumptions.options || assumptions.o, assumptions, options);
      assumptions = assumptions.a;
    }
    const a = Object.assign({}, FALLBACK.a, assumptions || {});
    const o = Object.assign({}, options || {});
    const aliases = { inputRate: "in", outputRate: "out", cacheReadRate: "cr", cacheWriteMultiplier: "wr", tokenizerFactor: "tok" };
    Object.keys(aliases).forEach(key => { if (o[key] == null && o[aliases[key]] != null) o[key] = o[aliases[key]]; });
    const defaults = { inputRate: 3, outputRate: 15, cacheReadRate: 0.3, cacheWriteMultiplier: 1.25, tokenizerFactor: 1, batchMultiplier: 1, residencyMultiplier: 1, historyMode: "full", cacheEligible: true, perDay: 5, people: 20, days: 21, budget: 1000 };
    const settings = Object.assign({}, defaults, o);
    if (o.cr === null || o.cacheReadRate === null) settings.cacheReadRate = settings.inputRate;
    const errors = [];
    const check = (key, value, max, min, integer) => {
      if (value === "" || value == null || typeof value === "boolean" || !Number.isFinite(Number(value))) { errors.push(key + " must be a finite number."); return; }
      if (Number(value) < (min || 0) || Number(value) > max) errors.push(key + " must be between " + (min || 0) + " and " + max + ".");
      if (integer && !Number.isInteger(Number(value))) errors.push(key + " must be a whole number.");
    };
    ASSUMPTIONS.forEach(([key]) => check(key, a[key], /^(cache|retry)$/.test(key) ? 100 : /^(turns|steps)$/.test(key) ? 1000 : 1e8, /^(turns|steps)$/.test(key) ? 1 : 0, /^(turns|steps)$/.test(key)));
    ["inputRate", "outputRate", "cacheReadRate"].forEach(key => check(key, settings[key], 1e6, 0));
    ["cacheWriteMultiplier", "tokenizerFactor", "batchMultiplier", "residencyMultiplier"].forEach(key => check(key, settings[key], 100, key === "cacheWriteMultiplier" ? 1 : 0.0001));
    check("people", settings.people, 1e6, 1, true);
    check("perDay", settings.perDay, 1e6, 0);
    check("days", settings.days, 366, 0, true);
    check("budget", settings.budget, 1e12, 0);
    if (!["full", "last", "none"].includes(settings.historyMode)) errors.push("Choose full, last-message, or no history.");
    if (Number(a.turns) * Number(a.steps) > 1000) errors.push("Use at most 1,000 model calls per task.");
    if (errors.length) return { valid: false, errors, cost: null, calls: [], cat: {} };
    Object.keys(a).forEach(key => { if (ASSUMPTIONS.some(row => row[0] === key)) a[key] = Number(a[key]); });
    Object.keys(defaults).forEach(key => { if (typeof defaults[key] === "number") settings[key] = Number(settings[key]); });
    const k = settings.tokenizerFactor, mult = settings.batchMultiplier * settings.residencyMultiplier;
    const pin = settings.inputRate / 1e6, pout = settings.outputRate / 1e6, pcr = settings.cacheReadRate / 1e6;
    const q = a.qWords / 0.75 * k, sys = a.sys * k, tools = a.tools * k, doc = a.doc * k;
    const res = a.res * k, stepOut = a.stepOut * k, ans = a.ansWords / 0.75 * k, think = a.think;
    const cachedFraction = settings.cacheEligible ? a.cache / 100 : 0;
    const cat = Object.fromEntries(CATEGORIES.map(([key]) => [key, 0]));
    const calls = [];
    let tin = 0, tout = 0, tcached = 0, cacheWrite = 0;
    for (let t = 1; t <= a.turns; t++) {
      const historyTurns = settings.historyMode === "none" ? 0 : settings.historyMode === "last" ? Math.min(1, t - 1) : t - 1;
      const hist = historyTurns * (q + ans + (a.steps - 1) * (res + stepOut));
      for (let j = 1; j <= a.steps; j++) {
        const priorSteps = (j - 1) * (res + stepOut), first = t === 1 && j === 1;
        const cf = first ? 0 : cachedFraction;
        let inputCost = q * pin;
        const parts = { sys, tools, doc, hist, res: priorSteps };
        Object.entries(parts).forEach(([key, tokens]) => {
          const value = tokens * ((1 - cf) * pin + cf * pcr);
          cat[key] += value * mult;
          inputCost += value;
        });
        cat.q += q * pin * mult;
        let write = 0;
        if (first && cachedFraction > 0) {
          write = (sys + tools + doc) * (settings.cacheWriteMultiplier - 1) * pin;
          cacheWrite += write * mult;
        }
        const written = j < a.steps ? stepOut : ans;
        cat.think += think * pout * mult;
        cat[j < a.steps ? "res" : "ans"] += written * pout * mult;
        const inTok = sys + tools + doc + hist + priorSteps + q;
        tin += inTok; tout += think + written; tcached += (inTok - q) * cf;
        calls.push({ t, j, sys, tools, doc, hist, steps: priorSteps, q, cf, think, out: written, inTok, outTok: think + written, cacheWrite: write * mult, cost: (inputCost + write + (think + written) * pout) * mult });
      }
    }
    const base = Object.values(cat).reduce((sum, value) => sum + value, 0) + cacheWrite;
    cat.retry = base * a.retry / 100;
    const cost = base + cat.retry;
    const simple = a.turns * (q * pin + ans * pout) * mult;
    const person = cost * settings.perDay * settings.days, team = person * settings.people;
    const visible = cat.q + cat.ans, hidden = cost - visible;
    if (![cost, person, team, tin, tout].every(Number.isFinite)) return { valid: false, errors: ["Reduce the assumptions. The estimate is too large."], cost: null, calls: [], cat: {} };
    return { valid: true, errors: [], cost, base, simple, ratio: simple ? cost / simple : 0, cat, cacheWrite, tin, tout, tcached, calls, k, T: a.turns, S: a.steps, mult, person, team, monthly: { task: cost, person, team }, visible, hidden, budget: settings.budget, remaining: settings.budget - team, assumptions: a, settings };
  }

  function getSession(config) {
    config = config || {};
    if (sessions.has(config)) return sessions.get(config);
    const presets = config.presets && config.presets.length ? config.presets : [FALLBACK];
    const models = config.models && config.models.length ? config.models : [MODEL];
    const state = { config, presets, models, mounts: [], days: config.days == null ? 21 : config.days, budget: config.budget == null ? 1000 : config.budget, historyMode: "full", cacheEligible: true };
    loadPreset(state, config.defaultPreset || "summary");
    sessions.set(config, state);
    return state;
  }
  function loadModel(state, id) {
    const model = state.models.find(item => item.id === id) || state.models[0];
    state.model = model.id;
    state.inputRate = model.inputRate == null ? model.in : model.inputRate;
    state.outputRate = model.outputRate == null ? model.out : model.outputRate;
    state.cacheReadRate = model.cacheReadRate == null ? (model.cr == null ? state.inputRate : model.cr) : model.cacheReadRate;
    state.cacheWriteMultiplier = model.cacheWriteMultiplier == null ? (model.wr == null ? 1 : model.wr) : model.cacheWriteMultiplier;
    state.tokenizerFactor = model.tokenizerFactor == null ? (model.tok == null ? 1 : model.tok) : model.tokenizerFactor;
  }
  function loadPreset(state, id) {
    const preset = state.presets.find(item => item.id === id) || state.presets[0];
    state.preset = preset.id;
    state.a = Object.assign({}, FALLBACK.a, preset.a);
    state.people = preset.people == null ? 20 : preset.people;
    state.perDay = preset.perDay == null ? 5 : preset.perDay;
    state.batchMultiplier = preset.batch ? 0.5 : 1;
    state.residencyMultiplier = 1;
    loadModel(state, preset.model);
  }
  const result = state => calculate(state.a, state);
  const text = (x, y, value, cls, extra) => `<text x="${x}" y="${y}" class="${cls || ""}" ${extra || ""}>${ESC(value)}</text>`;
  const rect = (x, y, w, h, cls, rx) => `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${h}" rx="${rx == null ? 8 : rx}" class="${cls || ""}"/>`;
  function svg(name, title, description, width, height, body) {
    return `<svg class="cl-chart" data-chart="${name}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${ESC(title)}"><title>${ESC(title)}</title><desc>${ESC(description)}</desc>${body}</svg>`;
  }
  const chartFrame = (title, body) => `<figure class="cl-figure"><figcaption>${ESC(title)}</figcaption><div class="cl-chart-scroll" tabindex="0" role="region" aria-label="${ESC(title)}">${body}</div></figure>`;
  function tokenFlow(r) {
    const labels = ["Questions", "Instructions", "Tools + data", "History + steps"];
    const vals = [r.calls.reduce((sum,c)=>sum+c.q,0), r.calls.reduce((sum,c)=>sum+c.sys,0), r.calls.reduce((sum,c)=>sum+c.tools+c.doc,0), r.calls.reduce((sum,c)=>sum+c.hist+c.steps,0)];
    let body = "";
    labels.forEach((label, index) => {
      const y = 8 + index * 43;
      body += rect(8, y, 205, 35, "cl-fill-soft") + text(19, y + 23, label, "cl-bold") + text(204, y + 23, num(vals[index]), "cl-muted", 'text-anchor="end"');
      body += `<path d="M213 ${y + 17} C234 ${y + 17} 243 95 260 95" class="cl-edge"/>`;
    });
    body += rect(260, 48, 145, 95, "cl-fill-dark") + text(332, 78, r.calls.length + " model calls", "cl-white cl-bold", 'text-anchor="middle"') + text(332, 108, num(r.assumptions.think) + " thinking", "cl-white", 'text-anchor="middle"') + text(332, 129, "tokens / call", "cl-white", 'text-anchor="middle"');
    body += `<path d="M405 95 H449" class="cl-edge cl-edge-red"/>` + rect(449, 57, 142, 76, "cl-fill-red") + text(520, 79, "Answer", "cl-white cl-bold", 'text-anchor="middle"') + text(520, 100, num(r.assumptions.ansWords), "cl-white", 'text-anchor="middle"') + text(520, 121, "words / message", "cl-white", 'text-anchor="middle"');
    return svg("token-flow", "Task input totals, model work, and answer", "Each input category sums tokens across all calls. Text enters each call. Thinking and the answer both contribute to output cost. History and tool results grow across calls.", 600, 182, body);
  }
  function summaryBars(state) {
    const example = Object.assign({ wordsIn: 2000, wordsOut: 500, outputPriceRatio: 4.5 }, state.config.summaryExample || {});
    const input = Math.round(example.wordsIn / 0.75), output = Math.round(example.wordsOut / 0.75);
    const weighted = Math.round(example.wordsOut / 0.75 * example.outputPriceRatio), maximum = Math.max(1, input, weighted);
    let body = text(8, 20, "Tokens: " + num(example.wordsIn) + " words in → " + num(example.wordsOut) + " words out", "cl-bold");
    [["Document", input, "cl-fill-dark"], ["Summary", output, "cl-fill-red"]].forEach(([label, value, cls], index) => {
      const y = 48 + index * 39;
      body += text(95, y + 3, label, "", 'text-anchor="end"') + rect(110, y - 12, value / maximum * 290, 19, cls, 3) + text(408, y + 3, num(value), "cl-bold");
    });
    body += text(8, 123, "Cost units: output rate = " + example.outputPriceRatio + " × input rate", "cl-bold");
    [["Document", input, "cl-fill-dark"], ["Summary", weighted, "cl-fill-red"]].forEach(([label, value, cls], index) => {
      const y = 151 + index * 39;
      body += text(95, y + 3, label, "", 'text-anchor="end"') + rect(110, y - 12, value / maximum * 290, 19, cls, 3) + text(408, y + 3, num(value), "cl-bold");
    });
    body += text(8, 226, "Illustration from v7. This rate ratio is not a price quote.", "cl-muted");
    return svg("summary-token-bars", "Shorter output can still cost more", "The v7 example compares a two-thousand-word document with a five-hundred-word summary. Token counts use words divided by 0.75. Cost bars apply the illustrative 4.5-times output price; they do not show the selected model bill.", 485, 240, body);
  }
  function iceberg(r) {
    const ratio = r.cost ? r.visible / r.cost : 0;
    const barWidth = 350;
    let body = `<path d="M85 85 L145 10 L205 85 L320 190 L25 190 Z" class="cl-ice"/><path d="M0 85 H400" class="cl-water"/>`;
    body += text(365, 30, "Visible: question + answer", "cl-bold", 'text-anchor="end"') + text(365, 56, money(r.visible), "cl-red cl-bold", 'text-anchor="end"');
    body += text(365, 120, "Hidden: context + work", "cl-bold", 'text-anchor="end"') + text(365, 146, money(r.hidden), "cl-bold", 'text-anchor="end"');
    body += rect(20, 210, barWidth, 15, "cl-fill-soft", 3) + rect(20, 210, r.cost ? barWidth : 0, 15, "cl-fill-dark", 3) + rect(20, 210, barWidth * ratio, 15, "cl-fill-red", 3);
    body += text(20, 249, "Visible cost: " + (ratio * 100).toFixed(1) + "% of the estimate", "cl-muted");
    return svg("cost-iceberg", "The cost behind the answer", "The red portion shows question and answer cost. Hidden cost includes instructions, tools, documents, history, tool steps, thinking, expected retries, and cache-write surcharge.", 400, 264, body);
  }
  function repeatCalls(r) {
    const shown = r.calls.slice(0, 24), maximum = Math.max(1, ...shown.map(call => call.inTok + call.outTok));
    const plotWidth = 350, col = plotWidth / shown.length;
    let body = text(20, 21, shown.length + " of " + r.calls.length + " calls shown", "cl-muted");
    shown.forEach((call, index) => {
      let bottom = 182;
      const segments = [[call.sys + call.tools + call.doc, "cl-fill-light"], [call.hist, "cl-fill-mid"], [call.steps, "cl-fill-dark"], [call.q, "cl-fill-red-light"], [call.outTok, "cl-fill-red"]];
      segments.forEach(([tokens, cls]) => { const height = tokens / maximum * 138; bottom -= height; body += rect(20 + index * col, bottom, Math.max(2, col - 3), height, cls, 0); });
      if (shown.length <= 12 || index % 4 === 0) body += text(20 + (index + 0.5) * col, 203, index + 1, "cl-muted", 'text-anchor="middle"');
    });
    body += text(20, 232, "Gray = context. Red = question + output.", "cl-muted");
    body += text(20, 255, "Bars show tokens before retry uplift.", "cl-muted");
    return svg("repeat-calls", "Each model call carries work", "Each stacked bar shows instructions, tool definitions, documents, repeated history, prior tool steps, the question, and output including thinking. Cache reads change cost but do not remove input tokens.", 400, 264, body);
  }
  function breakdown(r) {
    const rows = CATEGORIES.map(([key, label]) => [label, r.cat[key]]).concat([["Cache-write surcharge", r.cacheWrite]]);
    const max = Math.max(0.000001, ...rows.map(row => row[1]));
    const body = rows.map(([label, value], index) => {
      const y = 20 + index * 25;
      return text(4, y + 2, label, "") + rect(200, y - 12, value / max * 132, 17, index === 7 ? "cl-fill-red" : "cl-fill-dark", 3) + text(423, y + 2, money(value), "cl-bold", 'text-anchor="end"');
    }).join("");
    return svg("cost-breakdown", "All nine cost categories and cache write", "Category costs sum to the task estimate. Cache-write surcharge appears separately. Expected retry uplift is not a count of observed retries.", 430, 270, body);
  }
  function monthlyBudget(state, r) {
    const rows = state.presets.map(preset => {
      if (preset.id === state.preset) return [preset.name, r.person, true];
      const model = state.models.find(item => item.id === preset.model) || state.models[0];
      const other = calculate(preset.a, Object.assign({}, model, { batchMultiplier: preset.batch ? 0.5 : 1, people: preset.people, perDay: preset.perDay, days: state.days }));
      return [preset.name, other.valid ? other.person : 0, false];
    });
    const personBudget = state.budget / state.people;
    const max = Math.max(0.00001, personBudget, ...rows.map(row => row[1])) * 1.18;
    let body = "";
    rows.forEach(([label, value, selected], index) => {
      const y = 28 + index * 34;
      body += text(215, y + 2, label.length > 28 ? label.slice(0, 27) + "…" : label, selected ? "cl-red cl-bold" : "", 'text-anchor="end"');
      body += rect(230, y - 12, value / max * 440, 19, selected ? "cl-fill-red" : "cl-fill-dark", 3) + text(238 + value / max * 440, y + 2, money(value), "cl-bold");
    });
    const x = 230 + personBudget / max * 440;
    body += `<path d="M${x} 9 V${rows.length * 34 + 9}" class="cl-budget-line"/>`;
    body += text(230, rows.length * 34 + 38, "Per-person share of team budget: " + money(personBudget), "cl-muted");
    return svg("monthly-budget", "Monthly model cost per person", "Selected task uses your settings. Other tasks use their example assumptions. The dashed line shows team budget divided by people. This chart excludes warehouse, license, review, and operating costs.", 780, rows.length * 34 + 55, body);
  }
  function settingsDials(r) {
    const labels = [["Model rate", r.settings.inputRate / 10], ["Thinking", r.assumptions.think / 5000], ["Answer", r.assumptions.ansWords / 1000], ["Context", (r.assumptions.sys + r.assumptions.tools + r.assumptions.doc) / 30000]];
    let body = "";
    labels.forEach(([label, value], index) => {
      const x = 51 + index * 106, angle = -140 + Math.min(1, Math.max(0, value)) * 280;
      const rad = angle * Math.PI / 180, endX = x + 20 * Math.sin(rad), endY = 40 - 20 * Math.cos(rad);
      body += `<circle cx="${x}" cy="40" r="25" class="cl-dial"/><path d="M${x} 40 L${endX.toFixed(2)} ${endY.toFixed(2)}" class="cl-needle"/>` + text(x, 93, label, "cl-bold", 'text-anchor="middle"');
    });
    return svg("settings-dials", "Four controls change the estimate", "Model rates, thinking, answer length, and context volume influence token cost. Dial positions illustrate current assumptions. Temperature and sampling settings can affect behavior and indirect retry cost.", 425, 103, body);
  }
  function routing() {
    return svg("model-routing", "Match the model to the work", "Try a qualified small model on simple work. Use deeper reasoning for difficult work. Escalate uncertain cases. Measure quality before changing the route.", 425, 103,
      rect(8, 28, 118, 50, "cl-fill-dark") + text(67, 49, "Task + checks", "cl-white cl-bold", 'text-anchor="middle"') + text(67, 70, "Choose a route", "cl-white", 'text-anchor="middle"') + `<path d="M126 53 H176 V24 H198 M176 53 V78 H198" class="cl-edge"/>` + rect(198, 2, 218, 44, "cl-fill-soft") + text(210, 21, "Simple → small model", "cl-bold") + text(210, 40, "Keep the quality gate", "cl-muted") + rect(198, 57, 218, 44, "cl-fill-red") + text(210, 76, "Difficult → deeper work", "cl-white cl-bold") + text(210, 96, "Escalate uncertainty", "cl-white"));
  }
  function field(key, label, value, step, extra) {
    return `<label class="cl-field"><span>${ESC(label)}</span><input type="number" data-cost-field="${ESC(key)}" value="${ESC(value)}" step="${step || "any"}" min="${/^(turns|steps|people)$/.test(key) ? 1 : 0}" ${extra || ""}></label>`;
  }
  function select(key, label, value, choices) {
    return `<label class="cl-field"><span>${ESC(label)}</span><select data-cost-field="${ESC(key)}">${choices.map(([id, caption]) => `<option value="${ESC(id)}"${String(id) === String(value) ? " selected" : ""}>${ESC(caption)}</option>`).join("")}</select></label>`;
  }
  const modelField = state => select("model", "Example model rates", state.model, state.models.map(model => [model.id, model.name]));
  const presetField = state => select("preset", "Type of work", state.preset, state.presets.map(preset => [preset.id, preset.name]));
  function knobs(state, view) {
    if (view === "planner") return modelField(state) + field("think", "Thinking tokens / call", state.a.think, 100) + field("ansWords", "Answer words", state.a.ansWords, 10) + field("doc", "Document + data tokens", state.a.doc, 100);
    if (view === "hidden") return presetField(state) + field("turns", "Messages / task", state.a.turns, 1) + field("steps", "Calls / message", state.a.steps, 1) + select("historyMode", "History sent again", state.historyMode, [["full", "All earlier messages"], ["last", "Last message only"], ["none", "No earlier messages"]]);
    return field("people", "People", state.people, 1) + field("perDay", "Tasks / person / day", state.perDay, 1) + field("days", "Working days / month", state.days, 1) + field("budget", "Team model budget ($)", state.budget, 10);
  }
  function reference(state) {
    const params = state.config.params || [];
    const recs = state.config.recs || [];
    const limits = `<p>${ESC(state.config.rateStatus || "Example rates, not verified current prices.")}</p><ul>${(state.config.sourceLimitations || []).map(line=>`<li>${ESC(line)}</li>`).join("")}</ul>`;
    return `<details class="cl-details cl-reference"><summary>Developer reference: rates, settings, and task choices</summary><p>These examples come from the supplied v7 reference. Verify each setting for your model and API. Test the recommendation on your task.</p>${limits}<div class="cl-table-scroll" tabindex="0" role="region" aria-label="Editable example model rate reference"><table><thead><tr><th>Example model</th><th>Input / 1M</th><th>Cache read / 1M</th><th>Output / 1M</th><th>Write multiplier</th><th>Tokenizer factor</th></tr></thead><tbody>${state.models.map(m => `<tr><th>${ESC(m.name)}</th><td>${ESC(m.inputRate == null ? m.in : m.inputRate)}</td><td>${ESC(m.cacheReadRate == null ? (m.cr == null ? "No discount assumed" : m.cr) : m.cacheReadRate)}</td><td>${ESC(m.outputRate == null ? m.out : m.outputRate)}</td><td>${ESC(m.cacheWriteMultiplier == null ? m.wr : m.cacheWriteMultiplier)}</td><td>${ESC(m.tokenizerFactor == null ? m.tok : m.tokenizerFactor)}</td></tr>`).join("")}</tbody></table></div>${params.length ? `<div class="cl-table-scroll" tabindex="0" role="region" aria-label="Model setting reference"><table><thead><tr><th>Setting</th><th>Purpose</th><th>Cost effect</th><th>Claude example</th><th>Gemini example</th><th>CLI example</th></tr></thead><tbody>${params.map(p => `<tr><th>${ESC(p.s || p.name)}</th><td>${ESC(p.what)}</td><td>${ESC(p.cost)}</td><td>${ESC(p.claude)}</td><td>${ESC(p.gemini)}</td><td>${ESC(p.cc)}</td></tr>`).join("")}</tbody></table></div>` : ""}${recs.length ? `<div class="cl-table-scroll" tabindex="0" role="region" aria-label="Example task setting recommendations"><table><thead><tr><th>Task</th><th>Model</th><th>Thinking</th><th>Output limit</th><th>Sampling</th><th>Format</th></tr></thead><tbody>${recs.map(row => `<tr>${row.map((value, index) => `<${index ? "td" : "th"}>${ESC(value)}</${index ? "td" : "th"}>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}</details>`;
  }
  function details(state) {
    return `<details class="cl-details"><summary>Developer controls: assumptions, rates, and limits</summary><p>All rates are editable examples in US dollars per one million tokens. Cache discounts require eligible repeated input. Confirm provider rules and actual usage.</p><div class="cl-detail-fields">${ASSUMPTIONS.map(([key, label, step]) => field(key, label, state.a[key], step)).join("")}${field("inputRate", "Input rate ($ / 1M tokens)", state.inputRate, 0.01)}${field("outputRate", "Output rate ($ / 1M tokens)", state.outputRate, 0.01)}${field("cacheReadRate", "Cache read rate ($ / 1M tokens)", state.cacheReadRate, 0.01)}${field("cacheWriteMultiplier", "Cache write multiplier", state.cacheWriteMultiplier, 0.05)}${field("tokenizerFactor", "Text tokenizer factor", state.tokenizerFactor, 0.05)}${field("batchMultiplier", "Batch price multiplier", state.batchMultiplier, 0.05)}${field("residencyMultiplier", "Region / speed multiplier", state.residencyMultiplier, 0.05)}${field("people", "People", state.people, 1)}${field("perDay", "Tasks per person per day", state.perDay, 1)}${field("days", "Working days per month", state.days, 1)}${field("budget", "Team model budget ($)", state.budget, 10)}${modelField(state)}${select("historyMode", "Repeated history", state.historyMode, [["full", "All earlier messages"], ["last", "Last message only"], ["none", "None"]])}<label class="cl-checkbox"><input type="checkbox" data-cost-field="cacheEligible"${state.cacheEligible ? " checked" : ""}>Cache reads are eligible</label></div><ol class="cl-formulas"><li>Each call sends instructions, tools, documents, history, earlier tool steps, and the question.</li><li>Output includes thinking and either a tool call or an answer.</li><li>Price uncached input, cached input, and output at their separate rates.</li><li>The first call can add a cache-write surcharge. It receives no cache-read discount.</li><li>Apply batch and region factors once. Add expected retry uplift.</li><li>Monthly team cost = task cost × daily tasks × working days × people.</li></ol><p>Words ÷ 0.75 estimates text tokens. Apply the tokenizer factor once to text. Thinking already uses tokens. At most 1,000 calls per task. Retry uplift estimates expected cost; it does not simulate observed calls.</p></details>${reference(state)}`;
  }
  function stats(r, view) {
    const data = view === "hidden" ? [["visible", "Question + answer", r.visible, money], ["hidden", "Hidden work", r.hidden, money], ["calls", "Calls per task", r.calls.length, num]] : view === "budget" ? [["person", "Model cost / person / month", r.person, money], ["team", "Model cost / team / month", r.team, money], ["remaining", "Team budget remaining", r.remaining, money]] : [["task", "Model cost per task", r.cost, money], ["simple", "Question + answer estimate", r.simple, money], ["calls", "Model calls per task", r.calls.length, num]];
    return `<div class="cl-stats">${data.map(([key, label, value, format]) => `<div class="cl-stat"><span>${ESC(label)}</span><strong data-cost-value="${key}" data-value="${key}" data-number="${value}">${ESC(format(value))}</strong></div>`).join("")}</div>`;
  }
  function output(state, view) {
    const r = result(state);
    if (!r.valid) return `<div class="cl-error" role="alert"><strong>Correct the assumptions to see the estimate.</strong><ul>${r.errors.map(error => `<li>${ESC(error)}</li>`).join("")}</ul></div>`;
    let html = stats(r, view);
    if (view === "planner") html += `<div class="cl-planner-charts">${chartFrame("The answer is only one part of the bill", tokenFlow(r))}${chartFrame("Compare tokens with cost", summaryBars(state))}</div>` + `<div class="cl-inline-metrics"><span>Input: <b data-cost-value="input-tokens" data-number="${r.tin}">${num(r.tin)} tokens</b></span><span>Output: <b data-cost-value="output-tokens" data-number="${r.tout}">${num(r.tout)} tokens</b></span><span>Cached reads: <b data-cost-value="cached-tokens" data-number="${r.tcached}">${num(r.tcached)} tokens</b></span><span>Cache write: <b data-cost-value="cache-write" data-number="${r.cacheWrite}">${money(r.cacheWrite)}</b></span></div>`;
    else if (view === "hidden") html += `<div class="cl-hidden-grid">${chartFrame("Visible cost and hidden work", iceberg(r))}${chartFrame("Repeated context grows the work", repeatCalls(r))}${chartFrame("Where the estimate comes from", breakdown(r))}</div>`;
    else html += `<div class="cl-budget-grid">${chartFrame("Monthly model cost by type of work", monthlyBudget(state, r))}<div class="cl-budget-side">${chartFrame("Control the four cost drivers", settingsDials(r))}${chartFrame("Qualify the route before you change it", routing())}</div></div><div class="cl-budget-actions"><span><b>Budget owner:</b> monthly limit.</span><span><b>Weekly review:</b> actual usage.</span><span><b>Monthly adjustment:</b> routes and limits.</span></div>`;
    return html;
  }
  function content(state, view, staticMode) {
    const preset = state.presets.find(item => item.id === state.preset) || state.presets[0];
    return `${view === "budget" ? "" : `<div class="cl-intro"><p>${ESC(preset.plain)} <b>Example assumptions. No measured savings.</b></p>${staticMode ? `<span class="cl-static-label">Default: ${ESC(preset.name)}</span>` : ""}</div>`}${view === "planner" && !staticMode ? `<div class="cl-presets" role="group" aria-label="Load a type of work">${state.presets.map(p => `<button type="button" data-cost-preset="${ESC(p.id)}" aria-pressed="${p.id === state.preset}">${ESC(p.name)}</button>`).join("")}</div>` : ""}${staticMode ? `<div class="cl-default-summary">${ESC((state.models.find(model => model.id === state.model) || MODEL).name)} · ${ESC(state.a.turns)} messages × ${ESC(state.a.steps)} calls · ${ESC(state.people)} people · ${ESC(state.perDay)} tasks/day · ${ESC(state.days)} days/month</div>` : `<div class="cl-knobs">${knobs(state, view)}</div>`}<div data-cost-output aria-live="polite" aria-atomic="false">${output(state, view)}</div><p class="cl-scope">Example assumptions. Model token cost only. Add licenses, data queries, review, setup, and operations in the full-cost worksheet. No model calls run here.</p>${staticMode ? `<details class="cl-details"><summary>Default estimate assumptions</summary><div class="cl-default-summary">${ASSUMPTIONS.map(([key, label]) => `${ESC(label)}: ${ESC(state.a[key])}`).join(" · ")} · Input rate: ${ESC(state.inputRate)} · Cache read rate: ${ESC(state.cacheReadRate)} · Output rate: ${ESC(state.outputRate)} · Cache write multiplier: ${ESC(state.cacheWriteMultiplier)} · Tokenizer factor: ${ESC(state.tokenizerFactor)} · Batch factor: ${ESC(state.batchMultiplier)} · Region factor: ${ESC(state.residencyMultiplier)}</div><p>Expected retry uplift applies to base cost. The first call can add a separate cache-write surcharge. Repeated input receives a cache discount only when eligible.</p></details>` : details(state)}`;
  }
  function sync(state, origin) {
    state.mounts.forEach(({ root, view }) => {
      root.querySelector("[data-cost-output]").innerHTML = output(state, view);
      root.querySelectorAll("[data-cost-field]").forEach(control => {
        if (control === origin) return;
        const key = control.dataset.costField, value = Object.prototype.hasOwnProperty.call(state.a, key) ? state.a[key] : state[key];
        if (control.type === "checkbox") control.checked = !!value;
        else control.value = value;
      });
      root.querySelectorAll("[data-cost-preset]").forEach(button => button.setAttribute("aria-pressed", button.dataset.costPreset === state.preset));
      const intro = root.querySelector(".cl-intro p"), preset = state.presets.find(item => item.id === state.preset);
      if (intro && preset) intro.innerHTML = ESC(preset.plain) + " <b>Example assumptions. No measured savings.</b>";
    });
  }
  function create(view, config) {
    if (!["planner", "hidden", "budget"].includes(view)) throw new Error("Unknown cost lab view: " + view);
    const state = getSession(config), root = document.createElement("div");
    root.className = "cost-lab cost-lab-" + view;
    root.dataset.costView = view; root.dataset.costInstance = ++serial;
    root.innerHTML = content(state, view, false);
    state.mounts.push({ root, view });
    root.addEventListener("click", event => {
      const button = event.target.closest("[data-cost-preset]");
      if (!button || !root.contains(button)) return;
      loadPreset(state, button.dataset.costPreset); sync(state);
    });
    const change = event => {
      const control = event.target.closest("[data-cost-field]");
      if (!control || !root.contains(control)) return;
      const key = control.dataset.costField;
      if (key === "model") loadModel(state, control.value);
      else if (key === "preset") loadPreset(state, control.value);
      else if (key === "historyMode") state[key] = control.value;
      else if (key === "cacheEligible") state[key] = control.checked;
      else if (Object.prototype.hasOwnProperty.call(state.a, key)) state.a[key] = control.value === "" ? "" : Number(control.value);
      else state[key] = control.value === "" ? "" : Number(control.value);
      sync(state, control);
    };
    root.addEventListener("input", event => { if (event.target.tagName === "INPUT" && event.target.type !== "checkbox") change(event); });
    root.addEventListener("change", event => { if (event.target.tagName === "SELECT" || event.target.type === "checkbox") change(event); });
    return root;
  }
  function renderStatic(view, config) {
    if (!["planner", "hidden", "budget"].includes(view)) throw new Error("Unknown cost lab view: " + view);
    const state = getSession(config);
    return `<div class="cost-lab cost-lab-${view} cost-lab-static" data-cost-view="${view}">${content(state, view, true)}${reference(state)}</div>`;
  }
  global.ContextCostLab = { calculate, create, renderStatic };
})(window);
