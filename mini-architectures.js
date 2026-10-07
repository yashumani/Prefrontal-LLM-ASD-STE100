/* Native SVG mini architectures for the governed-context proposal.
 * The shared ContextMotion dispatcher owns every animation clock.
 * Authored geometry and text stay readable without motion or JavaScript.
 */
(function (global) {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const FONT = "Arial, sans-serif";
  const INK = "var(--ink, #000000)";
  const RED = "var(--red, #EE001E)";
  const PAPER = "var(--paper, #FFFFFF)";
  const MIST = "var(--mist, #F6F6F6)";
  const roles = new Set(["input", "agent", "model", "policy", "gate", "store", "consumer", "stop"]);
  const kinds = new Set(["flow", "return", "reference", "deny"]);
  let sequence = 0;

  function problem(plan, detail) {
    throw new Error(`Mini architecture ${plan?.id || "(unnamed)"}: ${detail}`);
  }
  function finite(value) { return typeof value === "number" && Number.isFinite(value); }
  function validId(value) { return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value); }
  function validSteps(plan, item, name) {
    if (!Array.isArray(item.steps) || !item.steps.length || item.steps.some(step =>
      !Number.isInteger(step) || step < 0 || step >= plan.stages.length)) {
      problem(plan, `${name} needs valid stage indexes.`);
    }
    if (new Set(item.steps).size !== item.steps.length) problem(plan, `${name} repeats a stage index.`);
  }
  function fallbackMeasure(value, options) {
    return [...String(value)].reduce((width, letter) => width + (/\s/.test(letter) ? .3
      : /[ilI.,'!:;|]/.test(letter) ? .28 : /[MW@%]/.test(letter) ? .9 : .56), 0) * options.fontSize;
  }
  function measure(value, options) {
    return global.ContextMotion?.measure ? global.ContextMotion.measure(value, options) : fallbackMeasure(value, options);
  }
  function wrap(value, maxWidth, options) {
    if (global.ContextMotion?.wrap) return global.ContextMotion.wrap(value, maxWidth, options);
    const lines = [];
    String(value).split(/\r?\n/).forEach(paragraph => {
      let line = "";
      paragraph.split(/\s+/).filter(Boolean).forEach(word => {
        const next = line ? `${line} ${word}` : word;
        if (line && measure(next, options) > maxWidth) { lines.push(line); line = word; }
        else line = next;
      });
      lines.push(line);
    });
    return lines;
  }
  function checkedLines(plan, value, width, fontSize, fontWeight, maximum, label) {
    const options = { fontSize, fontWeight, fontFamily: FONT };
    const lines = wrap(value, width, options);
    if (lines.length > maximum) problem(plan, `${label} needs ${lines.length} lines; widen its node or shorten the label to ${maximum} lines.`);
    lines.forEach(line => {
      if (measure(line, options) > width + .5) problem(plan, `${label} exceeds its ${width}px text area; widen its node.`);
    });
    return lines;
  }
  function nodeText(plan, node) {
    const title = checkedLines(plan, node.title, node.width - 58, 17, 700, 2, `Node ${node.id} title`);
    const body = (node.lines || []).flatMap(line => checkedLines(plan, line, node.width - 32, 14.5, 400, 2, `Node ${node.id} body`));
    if (body.length > 2) problem(plan, `Node ${node.id} body needs ${body.length} lines; keep a maximum of 2 lines.`);
    const lastBaseline = body.length ? 24 + (title.length - 1) * 19 + 21 + (body.length - 1) * 18 : 24 + (title.length - 1) * 19;
    if (lastBaseline + 12 > node.height) problem(plan, `Node ${node.id} needs height ${lastBaseline + 12}px for its text; its height is ${node.height}px.`);
    return { title, body };
  }

  function validate(plan) {
    if (!plan || typeof plan !== "object") problem(plan, "a plan object is required.");
    if (!validId(plan.id)) problem(plan, "id must start with a letter and contain letters, numbers, underscores, or hyphens.");
    if (typeof plan.title !== "string" || !plan.title.trim()) problem(plan, "a title is required.");
    if (typeof plan.summary !== "string" || !plan.summary.trim()) problem(plan, "a summary is required.");
    if (!Array.isArray(plan.viewBox) || plan.viewBox.length !== 2 || plan.viewBox.some(value => !finite(value) || value <= 0)) problem(plan, "viewBox must contain a finite width and height.");
    if (!Array.isArray(plan.anchorNodes) || !plan.anchorNodes.length || plan.anchorNodes.some(id => !validId(id))) problem(plan, "anchorNodes must name full-architecture node IDs.");
    if (new Set(plan.anchorNodes).size !== plan.anchorNodes.length) problem(plan, "anchorNodes contains duplicate IDs.");
    if (!plan.boundary || typeof plan.boundary.title !== "string" || typeof plan.boundary.detail !== "string") problem(plan, "an external policy boundary needs a title and detail.");
    if (!Array.isArray(plan.stages) || plan.stages.length < 4 || plan.stages.length > 6) problem(plan, "use 4 to 6 distinct mechanism stages.");
    if (plan.stages.some(stage => !stage || typeof stage.title !== "string" || !stage.title.trim() || typeof stage.detail !== "string" || !stage.detail.trim())) problem(plan, "each stage needs a title and detail.");
    if (!Array.isArray(plan.nodes) || !plan.nodes.length) problem(plan, "nodes are required.");
    if (!Array.isArray(plan.edges)) problem(plan, "edges must be an array.");
    const nodeIds = new Set();
    plan.nodes.forEach(node => {
      if (!validId(node.id) || nodeIds.has(node.id)) problem(plan, `Node ID ${node.id} is invalid or repeated.`);
      nodeIds.add(node.id);
      if (!roles.has(node.role)) problem(plan, `Node ${node.id} has an unknown role ${node.role}.`);
      if (typeof node.title !== "string" || !node.title.trim()) problem(plan, `Node ${node.id} needs a title.`);
      if (!Array.isArray(node.lines) || node.lines.length > 2 || node.lines.some(line => typeof line !== "string")) problem(plan, `Node ${node.id} needs at most 2 body strings.`);
      if (![node.x, node.y, node.width, node.height].every(finite) || node.width < 90 || node.height < 50) problem(plan, `Node ${node.id} has invalid geometry.`);
      if (node.x < 8 || node.y < 64 || node.x + node.width > plan.viewBox[0] - 8 || node.y + node.height > plan.viewBox[1] - 38) problem(plan, `Node ${node.id} overlaps the policy band, legend, or viewBox boundary.`);
      validSteps(plan, node, `Node ${node.id}`);
      nodeText(plan, node);
    });
    const edgeIds = new Set();
    plan.edges.forEach(edge => {
      if (!validId(edge.id) || edgeIds.has(edge.id)) problem(plan, `Edge ID ${edge.id} is invalid or repeated.`);
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) problem(plan, `Edge ${edge.id} refers to an unknown endpoint.`);
      if (!kinds.has(edge.kind)) problem(plan, `Edge ${edge.id} has an unknown kind ${edge.kind}.`);
      if (typeof edge.path !== "string" || !/^\s*M\s*[-+\d.]/i.test(edge.path) || /[^MmLlHhVvCcSsQqTtAaZzEe\d+.,\s-]/.test(edge.path)) problem(plan, `Edge ${edge.id} needs a native SVG path.`);
      const values = edge.path.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[Ee][-+]?\d+)?/g) || [];
      if (values.length < 3 || values.some(value => !Number.isFinite(Number(value)))) problem(plan, `Edge ${edge.id} has non-finite path coordinates.`);
      if (edge.label !== undefined && typeof edge.label !== "string") problem(plan, `Edge ${edge.id} label must be text.`);
      if (edge.labelAt !== undefined && (!Array.isArray(edge.labelAt) || edge.labelAt.length !== 2 || !edge.labelAt.every(finite))) problem(plan, `Edge ${edge.id} needs finite label coordinates.`);
      validSteps(plan, edge, `Edge ${edge.id}`);
    });
    return { valid: true, nodes: nodeIds.size, edges: edgeIds.size, stages: plan.stages.length, anchors: plan.anchorNodes.length };
  }

  function make(tag, attributes = {}, text) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function append(parent, child) { parent.appendChild(child); return child; }
  function text(parent, x, y, value, size, weight, fill = INK, anchor = "start", attributes = {}) {
    return append(parent, make("text", { x, y, "font-family": FONT, "font-size": size,
      "font-weight": weight, fill, "text-anchor": anchor, ...attributes }, value));
  }
  function icon(parent, role, x, y, color) {
    const group = append(parent, make("g", { transform: `translate(${x} ${y})`, fill: "none", stroke: color,
      "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }));
    const path = d => append(group, make("path", { d }));
    const circle = (cx, cy, r) => append(group, make("circle", { cx, cy, r }));
    if (role === "input") { path("M3 1 H12 L17 6 V19 H3 Z M12 1 V6 H17 M6 10 H14 M6 14 H14"); }
    else if (role === "agent") { path("M1 10 H6 M6 10 V4 H16 M6 10 H16 M6 10 V16 H16 M13 1 L16 4 L13 7 M13 7 L16 10 L13 13 M13 13 L16 16 L13 19"); }
    else if (role === "model") { path("M10 1 L18 6 V15 L10 20 L2 15 V6 Z M6 7 L14 14 M14 7 L6 14"); circle(6, 7, 1.2); circle(14, 7, 1.2); circle(6, 14, 1.2); circle(14, 14, 1.2); }
    else if (role === "policy") { path("M10 1 L18 4 V10 Q18 16 10 20 Q2 16 2 10 V4 Z M7 9 V7 A3 3 0 0 1 13 7 V9 M6 9 H14 V15 H6 Z"); }
    else if (role === "gate") { path("M10 1 L19 10 L10 19 L1 10 Z M6 10 L9 13 L14 7"); }
    else if (role === "store") { append(group, make("ellipse", { cx: 10, cy: 4, rx: 8, ry: 3 })); path("M2 4 V16 A8 3 0 0 0 18 16 V4 M2 10 A8 3 0 0 0 18 10"); }
    else if (role === "consumer") { path("M1 2 H19 V15 H1 Z M6 19 H14 M10 15 V19 M5 6 H15 M5 10 H12"); }
    else if (role === "stop") { circle(10, 10, 9); path("M6 6 L14 14 M14 6 L6 14"); }
  }
  function stagesAttributes(item) {
    return { "data-step": item.steps[0], "data-steps": item.steps.join(",") };
  }
  function renderNode(svg, plan, node) {
    const content = nodeText(plan, node);
    const dark = node.role === "agent";
    const stop = node.role === "stop";
    const fill = dark ? INK : stop ? "#FFF0F2" : node.role === "policy" ? MIST : PAPER;
    const color = dark ? PAPER : stop ? RED : INK;
    const group = append(svg, make("g", { class: `m-node m-stage mini-role-${node.role}`, "data-node": node.id,
      "data-role": node.role, ...stagesAttributes(node) }));
    append(group, make("rect", { x: node.x, y: node.y, width: node.width, height: node.height,
      rx: 11, fill, stroke: stop ? RED : INK, "stroke-width": node.role === "gate" ? 2 : 1.5,
      ...(node.role === "model" ? { "stroke-dasharray": "5 4" } : {}) }));
    icon(group, node.role, node.x + 12, node.y + 11, color);
    content.title.forEach((line, i) => text(group, node.x + 42, node.y + 24 + i * 19, line, 17, 700, color,
      "start", { "data-line-kind": "title", "data-text-width": node.width - 58 }));
    content.body.forEach((line, i) => text(group, node.x + 16, node.y + 24 + (content.title.length - 1) * 19 + 21 + i * 18,
      line, 14.5, 400, dark ? "#E7E7E7" : "#444444", "start", { "data-line-kind": "body", "data-text-width": node.width - 32 }));
  }
  function renderEdge(svg, plan, edge, prefix) {
    const isRed = edge.kind === "return" || edge.kind === "deny";
    const reference = edge.kind === "reference";
    const pathId = `${prefix}-path-${edge.id}`;
    const group = append(svg, make("g", { class: "m-edge m-stage", "data-edge": edge.id,
      "data-from": edge.from, "data-to": edge.to, "data-kind": edge.kind, ...stagesAttributes(edge) }));
    append(group, make("path", { id: pathId, d: edge.path, fill: "none", stroke: reference ? "#737373" : isRed ? RED : INK,
      "stroke-width": reference ? 1.5 : 2, "stroke-linecap": "round", "stroke-linejoin": "round",
      ...((reference || edge.kind === "return") ? { "stroke-dasharray": reference ? "4 5" : "7 4" } : {}),
      ...(!reference ? { "marker-end": `url(#${prefix}-${isRed ? "red" : "ink"}-arrow)` } : {}) }));
    if (!reference) append(group, make("circle", { class: "m-dot", r: 4, fill: RED, stroke: PAPER,
      "stroke-width": 1.5, "data-path": `#${pathId}`, "aria-hidden": "true" }));
    if (edge.label) {
      const from = plan.nodes.find(node => node.id === edge.from);
      const to = plan.nodes.find(node => node.id === edge.to);
      const [x, y] = edge.labelAt || [(from.x + from.width / 2 + to.x + to.width / 2) / 2,
        (from.y + from.height / 2 + to.y + to.height / 2) / 2];
      const width = measure(edge.label, { fontSize: 13.5, fontWeight: 700, fontFamily: FONT }) + 12;
      append(group, make("rect", { x: x - width / 2, y: y - 14, width, height: 20, rx: 3, fill: PAPER }));
      text(group, x, y, edge.label, 13.5, 700, isRed ? RED : INK, "middle", { "data-line-kind": "edge-label" });
    }
  }
  function renderLegend(svg, width, height, prefix) {
    const y = height - 13;
    const entries = [{ x: 18, kind: "flow", label: "Flow" }, { x: width * .22, kind: "return", label: "Revision / return" },
      { x: width * .47, kind: "reference", label: "Reference only" }, { x: width * .74, kind: "deny", label: "Blocked" }];
    const group = append(svg, make("g", { class: "mini-architecture-legend", "aria-hidden": "true" }));
    entries.forEach(entry => {
      const red = entry.kind === "return" || entry.kind === "deny";
      append(group, make("path", { d: `M${entry.x} ${y - 4} H${entry.x + 27}`, fill: "none",
        stroke: entry.kind === "reference" ? "#737373" : red ? RED : INK, "stroke-width": 1.6,
        ...((entry.kind === "reference" || entry.kind === "return") ? { "stroke-dasharray": entry.kind === "reference" ? "4 4" : "6 3" } : {}),
        ...(entry.kind !== "reference" ? { "marker-end": `url(#${prefix}-${red ? "red" : "ink"}-arrow)` } : {}) }));
      text(group, entry.x + 38, y, entry.label, 13, 400);
    });
  }

  function create(plan) {
    validate(plan);
    const prefix = `mini-${plan.id}-${++sequence}`;
    const [width, height] = plan.viewBox;
    const svg = make("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", width: "100%",
      "aria-labelledby": `${prefix}-title ${prefix}-desc`, "preserveAspectRatio": "xMidYMid meet",
      class: "motion-diagram mini-architecture-svg", "data-mini-architecture": plan.id,
      "data-architecture-anchors": plan.anchorNodes.join(",") });
    append(svg, make("title", { id: `${prefix}-title` }, plan.title));
    const stageDescription = plan.stages.map((stage, index) => `Stage ${index + 1}, ${stage.title}: ${stage.detail}`).join(" ");
    const nodeDescription = plan.nodes.map(node => `${node.title}, ${node.role}: ${node.lines.join(". ")}.`).join(" ");
    append(svg, make("desc", { id: `${prefix}-desc` }, `${plan.summary} ${plan.boundary.title}: ${plan.boundary.detail} ${stageDescription} ${nodeDescription} Solid arrows show flow. Dashed red arrows show revision or return. Dashed gray lines show references, not workflow. Red arrows show a blocked path. This is an architecture proposal.`));
    const defs = append(svg, make("defs"));
    [["ink", INK], ["red", RED]].forEach(([name, fill]) => {
      const marker = append(defs, make("marker", { id: `${prefix}-${name}-arrow`, viewBox: "0 0 10 10",
        refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto", markerUnits: "strokeWidth" }));
      append(marker, make("path", { d: "M1 1 L9 5 L1 9 Z", fill }));
    });
    const boundary = append(svg, make("g", { class: "mini-policy-boundary", "data-boundary": "external-policy" }));
    append(boundary, make("rect", { x: 8, y: 1, width: width - 16, height: 44, rx: 8, fill: MIST, stroke: INK, "stroke-width": 1 }));
    icon(boundary, "policy", 19, 11, INK);
    const boundaryTitle = checkedLines(plan, plan.boundary.title, width - 74, 16, 700, 1, "Policy boundary title");
    const boundaryDetail = checkedLines(plan, plan.boundary.detail, width - 74, 13.5, 400, 1, "Policy boundary detail");
    text(boundary, 50, 18, boundaryTitle[0], 16, 700);
    text(boundary, 50, 36, boundaryDetail[0], 13.5, 400);
    plan.stages.forEach((stage, index) => append(svg, make("g", { class: "stage-meta", "data-step": index,
      "data-stage": stage.title, "data-stage-detail": stage.detail, "aria-hidden": "true" })));
    plan.edges.forEach(edge => renderEdge(svg, plan, edge, prefix));
    plan.nodes.forEach(node => renderNode(svg, plan, node));
    renderLegend(svg, width, height, prefix);
    return svg;
  }

  global.ContextMiniArchitectures = { create, validate };
})(typeof window === "undefined" ? globalThis : window);
