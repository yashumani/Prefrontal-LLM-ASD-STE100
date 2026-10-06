"use strict";

// Self-contained SVG illustrations. Motion follows the same paths as static arrows.
// The host selects a stage; CSS owns node highlighting and packet visibility.
window.ContextDiagrams = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const C = { navy: "var(--navy, #172b4d)", ink: "var(--ink, #102d3e)", blue: "var(--blue, #2f5aa6)", cyan: "var(--cyan, #53c8d8)", gold: "var(--gold, #efb94e)", canvas: "var(--canvas, #eaf2f8)", white: "var(--white, #ffffff)" };
  let render = 0;
  const esc = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch]));
  function create(kind) {
    if (!["cover", "pipeline", "memory", "router"].includes(kind)) throw new Error(`Unknown diagram: ${kind}`);
    const id = `context-${kind}-${++render}`;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 520 400");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-labelledby", `${id}-title ${id}-desc`);
    svg.setAttribute("class", `motion-diagram motion-diagram-${kind}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.style.display = "block";
    svg.style.maxWidth = "100%";
    const titles = {
      cover: "Evidence becomes working context within a permission boundary",
      pipeline: "Evidence admission: capture, propose, validate and commit",
      memory: "Four memory layers with correction and invalidation",
      router: "A bounded request router governed outside the model"
    };
    const descriptions = {
      cover: "Original sources link to structured memory, which supplies the current task context. Replaceable model, search and tool adapters consume this context. A permission boundary governs every layer. This is an unimplemented architecture proposal.",
      pipeline: "Capture preserves the original source. Propose creates candidate claims, not verified facts. A policy gate controls validation. Validate checks evidence, conflicts and scope before commit stores admitted claims with status. This is an unimplemented architecture proposal.",
      memory: "Original sources supply structured memory, rebuildable indexes and summaries, and the working task context. Correction or invalidation starts by checking the source, preserves original records, and rebuilds affected derived views under existing access and retention rules. Authority applies at every layer; a rebuilt view cannot grant permission. This is an unimplemented architecture proposal.",
      router: "A request with a goal and constraints enters a bounded decision. Guard policy outside the model restricts routes to permitted memory access, authorized tools or labeled reasoning. A model cannot grant itself permission. This is an unimplemented architecture proposal."
    };
    let markup = `<title id="${id}-title">${titles[kind]}</title><desc id="${id}-desc">${descriptions[kind]}</desc><defs><marker id="${id}-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9 Z" fill="${C.blue}"/></marker><marker id="${id}-gold" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1 L9 5 L1 9 Z" fill="${C.gold}"/></marker></defs>`;
    const add = value => { markup += value; };
    const text = (x, y, value, size = 18, fill = C.ink, anchor = "middle", weight = 500, mono = false) => `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${fill}" font-family="${mono ? "Consolas, monospace" : "Segoe UI, Arial, sans-serif"}" font-size="${size}" font-weight="${weight}">${esc(value)}</text>`;
    const rect = (x, y, w, h, fill = C.white, stroke = C.blue, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="1.5" ${extra}/>`;
    const line = (name, d, dashed = false, color = C.blue) => {
      add(`<path id="${id}-${name}" d="${d}" fill="none" stroke="${color}" stroke-width="2" ${dashed ? 'stroke-dasharray="6 5"' : ""} marker-end="url(#${id}-${color === C.gold ? "gold" : "arrow"})"/>`);
    };
    const packet = (name, color = C.cyan) => {
      add(`<circle class="m-dot" r="5" fill="${color}" stroke="${C.white}" stroke-width="2"><animateMotion dur="1.6s" repeatCount="indefinite" calcMode="linear"><mpath href="#${id}-${name}"/></animateMotion></circle>`);
    };
    const captureGroup = (step, draw, title, detail, className = "m-node m-stage") => {
      const start = markup.length;
      draw();
      const content = markup.slice(start);
      const caption = title === undefined ? "" : ` data-stage="${esc(title)}" data-stage-detail="${esc(detail)}"`;
      markup = markup.slice(0, start) + `<g class="${esc(className)}" data-step="${esc(step)}"${caption}>${content}</g>`;
    };
    const edge = (step, name, d, dashed = false, color = C.blue) => {
      captureGroup(step, () => {
        line(name, d, dashed, color);
        packet(name, color === C.gold ? C.gold : C.cyan);
      }, undefined, undefined, "m-edge m-stage");
    };
    const box = (x, y, w, h, title, detail, dark = false) => {
      add(rect(x, y, w, h, dark ? C.navy : C.white));
      add(text(x + w / 2, y + 25, title, 19, dark ? C.white : C.ink, "middle", 600));
      add(text(x + w / 2, y + 47, detail, 15, dark ? C.cyan : C.blue));
    };
    const footer = () => add(text(260, 390, "Architecture proposal · not implemented", 15, C.blue));

    if (kind === "cover") {
      add(rect(28, 30, 464, 333, C.canvas, C.gold, 'stroke-dasharray="7 5"'));
      add(rect(134, 17, 252, 26, C.canvas, "none"));
      add(text(260, 36, "PERMISSION BOUNDARY", 15, C.ink, "middle", 600, true));
      edge(1, "source-memory", "M260 111 L260 130");
      edge(2, "memory-context", "M260 186 L260 205");
      edge(3, "context-adapters", "M260 261 L260 280");
      captureGroup(0, () => box(71, 55, 378, 56, "Original sources", "Versioned records · ownership"), "Original sources", "Keep owned, versioned source records as the evidence base.");
      captureGroup(1, () => box(71, 130, 378, 56, "Evidence-linked memory", "Claims · provenance · uncertainty"), "Evidence-linked memory", "Link claims to their source evidence and retain provenance and uncertainty.");
      captureGroup(2, () => box(71, 205, 378, 56, "Working task context", "Current goal · relevant evidence", true), "Working task context", "Select permitted evidence relevant to the current task and goal.");
      captureGroup(3, () => box(71, 280, 378, 56, "Replaceable adapters", "Models · search · authorized tools"), "Replaceable adapters", "Pass permitted task context to model, search, or authorized tool adapters.");
      add(text(260, 354, "Authority applies across every layer.", 15));
      footer();
    }

    if (kind === "pipeline") {
      add(text(260, 28, "EVIDENCE ADMISSION", 15, C.blue, "middle", 600, true));
      edge(1, "capture-propose", "M221 108 L299 108");
      edge(2, "propose-validate", "M398 152 L398 234");
      edge(3, "validate-commit", "M299 280 L221 280");
      const stage = (x, y, number, title, first, second, dark = false) => {
        add(rect(x, y, 197, 94, dark ? C.navy : C.white));
        add(text(x + 17, y + 24, number, 15, dark ? C.cyan : C.blue, "start", 500, true));
        add(text(x + 48, y + 24, title, 20, dark ? C.white : C.ink, "start", 600));
        add(text(x + 98.5, y + 53, first, 15, dark ? C.white : C.ink));
        add(text(x + 98.5, y + 76, second, 15, dark ? C.cyan : C.blue));
      };
      captureGroup(0, () => stage(24, 58, "01", "Capture", "Original stays original", "Retain source + version"), "Capture", "Preserve the original source and its version before proposing claims.");
      captureGroup(1, () => stage(299, 58, "02", "Propose", "Candidate claims", "Proposal ≠ verified fact"), "Propose", "Create candidate claims whose evidence and status still require validation.");
      captureGroup(2, () => stage(299, 234, "03", "Validate", "Evidence · conflicts", "Scope + permission"), "Validate", "Check evidence, conflicts, scope, and permission through the policy gate.");
      captureGroup(3, () => stage(24, 234, "04", "Commit", "Admit with status", "Link back to evidence", true), "Commit", "Store admitted claims with status and a reference to their source evidence.");
      captureGroup(2, () => {
        add(rect(324, 178, 148, 34, C.canvas, C.gold));
        add(text(398, 201, "POLICY GATE", 15, C.ink, "middle", 600, true));
      });
      add(text(201, 188, "Claims require", 16));
      add(text(201, 210, "admission checks.", 16));
      add(text(260, 356, "A source reference remains with each admitted claim.", 15));
      footer();
    }

    if (kind === "memory") {
      add(text(260, 26, "AUTHORITY ENFORCED AT EVERY LAYER", 15, C.ink, "middle", 600, true));
      add(`<path d="M48 53 H31 V351 H48" fill="none" stroke="${C.gold}" stroke-width="3"/>`);
      edge(1, "source-structured", "M246 298 L246 271");
      edge(2, "structured-views", "M246 216 L246 189");
      edge(3, "views-context", "M246 134 L246 107");
      edge(4, "correction", "M420 80 H487 V326 H420", true, C.gold);
      captureGroup(0, () => box(71, 298, 349, 55, "Original sources", "Owned records · versions"), "Original sources", "Keep permitted source records under explicit retention rules. Preserve their versions to check generated memory.");
      captureGroup(1, () => box(71, 216, 349, 55, "Structured memory", "Claims · provenance · status"), "Structured memory", "Link claims, dates, status, and unresolved conflicts to source evidence. A model's assertion is not proof.");
      captureGroup(2, () => box(71, 134, 349, 55, "Rebuildable views", "Indexes · summaries · caches"), "Rebuildable views", "Derive indexes, summaries, and caches from structured memory. Invalidate them when sources or access change.");
      captureGroup(3, () => box(71, 52, 349, 55, "Working context", "Goal + selected evidence", true), "Working context", "Select permitted evidence for the current goal and constraints. Keep it within the model's input limit.");
      add(`<text x="450" y="203" transform="rotate(90 450 203)" text-anchor="middle" fill="${C.ink}" font-family="Segoe UI, Arial, sans-serif" font-size="15">Correct / invalidate</text>`);
      captureGroup(4, () => {
        add(rect(424, 276, 80, 32, C.canvas, C.gold));
        add(text(464, 289, "Check source", 10, C.ink));
        add(text(464, 301, "Rebuild views", 10, C.ink));
      }, "Correct or invalidate", "Check the source while preserving original records, then rebuild affected derived views under existing access and retention rules.");
      add(text(260, 372, "Rebuilding a view cannot grant permission.", 15));
      footer();
    }

    if (kind === "router") {
      add(rect(16, 118, 488, 251, C.canvas, C.gold, 'stroke-dasharray="7 5"'));
      add(rect(64, 108, 392, 24, C.canvas, "none"));
      add(text(260, 127, "GUARD POLICY · OUTSIDE THE MODEL", 15, C.ink, "middle", 600, true));
      edge(1, "request-decision", "M260 95 L260 152");
      edge(2, "decision-memory", "M260 218 V247 H96 V283");
      edge(3, "decision-tool", "M260 218 L260 283");
      edge(4, "decision-reasoning", "M260 218 V247 H424 V283");
      captureGroup(0, () => box(111, 34, 298, 61, "Request + goal", "Scope · constraints · permissions"), "Request", "Establish the goal, scope, constraints, and existing permissions for the request.");
      captureGroup(1, () => box(132, 152, 256, 66, "Bounded decision", "Only permitted routes", true), "Bounded decision", "External guard policy restricts the available branch alternatives for this request.");
      captureGroup(2, () => box(27, 283, 138, 62, "Memory", "Evidence lookup"), "Memory option", "Memory lookup is a permitted branch alternative, not a required step before tools or reasoning.");
      captureGroup(3, () => {
        add(rect(191, 283, 138, 62));
        add(text(260, 307, "Authorized tool", 17, C.ink, "middle", 600));
        add(text(260, 330, "Scoped action", 15, C.blue));
      }, "Tool option", "An authorized tool is a scoped branch alternative, not a mandatory next step after memory.");
      captureGroup(4, () => box(355, 283, 138, 62, "Reasoning", "Label inference"), "Reasoning option", "Labeled reasoning is a branch alternative, not a mandatory step after the other options.");
      add(text(260, 362, "A model cannot grant itself permission.", 15));
      footer();
    }
    svg.innerHTML = markup;
    return svg;
  }
  function createIndustry(kind, input) {
    if (!["atlas", "product", "flow", "metric"].includes(kind)) throw new Error(`Unknown industry graphic: ${kind}`);
    const id = `industry-${kind}-${++render}`;
    const svg = document.createElementNS(NS, "svg");
    const atlas = kind === "atlas" || kind === "product";
    const sectors = kind === "product" ? input.lenses : kind === "atlas" ? input : [input];
    const sector = sectors[0];
    const plot = kind === "metric";
    const viewBox = atlas ? "0 0 720 510" : plot ? "0 0 440 155" : "0 0 900 240";
    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-labelledby", `${id}-title ${id}-desc`);
    svg.setAttribute("class", plot ? "insight-chart" : `motion-diagram industry-svg industry-svg-${atlas ? 'atlas' : kind}${kind === 'product' ? ' product-map' : ''}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    if (!atlas) svg.setAttribute("data-sector", sector.id);
    const title = kind === "product" ? "Prefrontal connects cost, performance, accuracy and trust through governed context" : kind === "atlas" ? "Four industries connect to shared context checks in separate vaults" : plot ? `${sector.name}: ${sector.metric.value}. ${sector.metric.label}` : `${sector.name}: proposed evidence-to-review workflow`;
    const desc = kind === "product" ? "Four product objectives surround one proposed governed context layer. Cost, performance, accuracy and trust need agreed pilot measurements. This diagram reports no achieved result." : kind === "atlas" ? "Telecom, electricity utilities, healthcare and hospitality have different pressures. Each task needs its own evidence, time, scope and responsible owner. Connections illustrate shared design checks, not data sharing between industries. Industry metrics appear with dates and sources on the case slides. Proposed architecture, not implemented." : plot ? `${sector.metric.scope} ${sector.metric.period}. ${sector.metric.limitation} ${sector.metric.definition}` : `${sector.task} Link the evidence. ${sector.humanGate} Prepare: ${sector.output} This is an illustrative, unimplemented workflow.`;
    let markup = `<title id="${id}-title">${esc(title)}</title><desc id="${id}-desc">${esc(desc)}</desc>`;
    const text = (x, y, value, size = 20, fill = "var(--ink, #102d3e)", anchor = "start", weight = 500) => `<text x="${x}" y="${y}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}">${esc(value)}</text>`;
    const rectangle = (x, y, width, height, fill, stroke, radius = 14) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    const node = (step, title, detail, body) => `<g class="m-node m-stage" data-step="${step}" data-stage="${esc(title)}" data-stage-detail="${esc(detail)}">${body}</g>`;
    const edge = (step, name, path, color) => `<g class="m-edge m-stage" data-step="${step}"><path id="${id}-${name}" d="${path}" fill="none" stroke="${color}" stroke-width="2.5" marker-end="url(#${id}-arrow)"/><circle class="m-dot" r="5" fill="${color}"><animateMotion dur="1.6s" repeatCount="indefinite"><mpath href="#${id}-${name}"/></animateMotion></circle></g>`;
    if (!plot) markup += `<defs><marker id="${id}-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1 L9 5 L1 9 Z" fill="var(--blue, #147dfa)"/></marker></defs>`;
    if (atlas) {
      markup += `<path d="M360 38V475M35 255H685" stroke="#254963" stroke-dasharray="2 8" fill="none"/><circle cx="360" cy="255" r="151" fill="none" stroke="#254963" stroke-dasharray="3 8"/><circle cx="360" cy="255" r="118" fill="none" stroke="#345e78"/>`;
      const positions = [[30, 38], [450, 38], [30, 356], [450, 356]];
      const paths = ["M270 94 C348 94 302 172 336 206", "M450 94 C372 94 418 172 384 206", "M270 414 C348 414 302 330 336 306", "M450 414 C372 414 418 330 384 306"];
      sectors.forEach((s, i) => { markup += edge(i, s.id, paths[i], `var(--${s.id}, ${s.color})`); });
      sectors.forEach((s, i) => {
        const [x, y] = positions[i], color = `var(--${s.id}, ${s.color})`;
        if (kind === 'product') {
          const copy = {cost:['Task economics','Include the full cost'],performance:['Responsive work','Measure the full path'],accuracy:['Meaning + evidence','Check the task result'],trust:['Visible control','Keep the owner involved']}[s.id];
          markup += node(i,s.name,s.goal + '. Measure: ' + s.measure,
            rectangle(x,y,240,112,'#12324a',color)+text(x+17,y+27,s.name.toUpperCase(),16,color,'start',700)+text(x+17,y+66,copy[0],22,'#f3f8ff','start',700)+text(x+17,y+94,copy[1],15,'#c5dbea'));
          return;
        }
        const brief = { telecom: "Traffic growth", utilities: "Queued renewables", healthcare: "Receive / integrate", hospitality: "Staffing shortages" }[s.id];
        markup += node(i, s.name, s.solution,
          rectangle(x, y, 240, 112, "#12324a", color) + text(x + 17, y + 27, s.shortName.toUpperCase(), 16, color, "start", 700) + text(x + 17, y + 69, s.metric.value, 34, "#f3f8ff", "start", 700) + text(x + 17, y + 94, brief, 17, "#c5dbea"));
      });
      markup += node(4, kind === 'product' ? 'Prefrontal · governed context' : "Shared checks, separate vaults", kind === 'product' ? 'One proposed context foundation. Configure each workflow. Prove its value and boundaries in a measured pilot.' : "Link evidence for one authorized task. Preserve time, conditions and authority. Keep industry and project records separate.", rectangle(267, 206, 186, 100, "#e8f4fc", "var(--cyan, #53c8d8)", 22) + text(360, 240, kind === 'product' ? 'Prefrontal' : "Governed", 24, "#102d3e", "middle", 700) + text(360, 269, "context", 24, "#102d3e", "middle", 700) + text(360, 290, "EVIDENCE + OWNER", 11, "#2f5aa6", "middle", 600));
      markup += text(360, 493, kind === 'product' ? 'Product objectives · measured in the pilot' : "Shared checks do not mean shared private records.", 16, "#c5dbea", "middle");
    } else if (kind === "flow") {
      const color = `var(--${sector.id}, ${sector.color})`;
      markup += text(22, 22, "PROPOSED WORKFLOW · REVIEWABLE OUTPUT", 13, "var(--muted, #50677b)");
      markup += edge(1, "task-context", "M188 121H238", color) + edge(2, "context-check", "M520 121H567", color) + edge(3, "check-draft", "M697 121H746", color);
      markup += node(0, "Task arrives", sector.task, rectangle(22, 66, 166, 110, "var(--white, #fff)", color) + text(105, 110, "Task", 26, undefined, "middle", 700) + text(105, 140, "Goal + entity", 17, undefined, "middle"));
      let evidence = rectangle(238, 37, 282, 174, "var(--canvas, #eaf2f8)", color) + text(257, 66, "Linked evidence", 23, undefined, "start", 700);
      sector.inputLabels.forEach((label, i) => { evidence += `<circle cx="258" cy="${88+i*23}" r="3" fill="${color}"/>` + text(271, 94+i*23, label, 17); });
      markup += node(1, "Link the evidence", sector.inputs.join(" · "), evidence);
      markup += node(2, "Check the boundary", sector.humanGate, rectangle(567, 66, 130, 110, "var(--navy, #172b4d)", color) + text(632, 108, "Check", 25, "#fff", "middle", 700) + text(632, 140, "Authority", 17, "#bceaf1", "middle"));
      markup += node(3, "Prepare a reviewable result", sector.output + " " + sector.test, rectangle(746, 66, 132, 110, "var(--white, #fff)", color) + text(812, 108, "Draft", 25, undefined, "middle", 700) + text(812, 140, "Owner reviews", 16, undefined, "middle"));
      markup += text(450, 234, "The illustration neither approves nor executes an external action.", 14, "var(--muted, #50677b)", "middle");
    } else if (sector.metric.kind === "growth") {
      const labels = ["Q2 2025", "Q2 2026"];
      sector.metric.rates.forEach((value, i) => {
        const y = 26 + i*48, width = value/130*290;
        markup += text(5, y+18, labels[i], 17) + `<rect class="chart-fill" data-value="${value}" x="110" y="${y}" width="${width}" height="27" rx="4" fill="${i ? sector.color : '#9eafbe'}"/>` + text(115+width, y+20, value, 17);
      });
      markup += `<path d="M110 110H400" stroke="#9eafbe"/>` + text(110, 129, "0", 13) + text(205, 148, "Index: Q2 2025 = 100", 16, "var(--muted, #50677b)", "middle");
    } else if (sector.metric.kind === "capacity") {
      for (let i=0; i<sector.metric.nodeCount; i++) markup += `<circle class="capacity-node" cx="${28+(i%9)*45}" cy="${38+Math.floor(i/9)*44}" r="12" fill="${sector.color}"/>`;
      markup += text(10, 135, "Each node = 100 GW of the lower bound", 17, "var(--muted, #50677b)");
    } else if (sector.metric.kind === "comparison") {
      const labels = ["Receive", "Integrate"];
      sector.metric.rates.forEach((value, i) => {
        const y=22+i*48;
        markup += text(4, y+21, labels[i], 19) + `<rect x="112" y="${y}" width="275" height="28" rx="4" fill="#e1e7ed"/><rect class="chart-fill" data-value="${value}" x="112" y="${y}" width="${value/100*275}" height="28" rx="4" fill="${sector.color}"/>` + text(395, y+21, value+"%", 17);
      });
      markup += text(112, 133, "0", 13) + text(387, 133, "100%", 13, undefined, "end") + text(112, 152, "Hospital-level capability rates", 16, "var(--muted, #50677b)");
    } else if (sector.metric.kind === "share") {
      for (let i=0; i<100; i++) markup += `<circle class="chart-dot${i<sector.metric.rates[0] ? ' is-filled' : ''}" cx="${15+(i%10)*14}" cy="${13+Math.floor(i/10)*14}" r="5" fill="${i<sector.metric.rates[0] ? sector.color : '#dde4eb'}"/>`;
      markup += text(171, 45, "65 of 100", 26, undefined, "start", 700) + text(171, 73, "percentage points", 17) + text(171, 110, "Survey: 282 respondents", 16, "var(--muted, #50677b)");
    }
    svg.innerHTML = markup;
    return svg;
  }
  return Object.freeze({ create, createIndustry });
})();
