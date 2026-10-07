"use strict";

// Self-contained SVG illustrations. Motion follows the same paths as static arrows.
// The host selects a stage; CSS owns node highlighting and packet visibility.
window.ContextDiagrams = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const C = { navy: "var(--navy, #172b4d)", ink: "var(--ink, #000000)", blue: "var(--blue, #000000)", cyan: "var(--cyan, #53c8d8)", gold: "var(--gold, #efb94e)", canvas: "var(--canvas, #eaf2f8)", white: "var(--white, #ffffff)" };
  let render = 0;
  const esc = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch]));
  function draw(svg, markup) {
    // Authored SVG remains plain native elements. Build-time serialization has no DOM.
    if(typeof DOMParser==='undefined'){svg.innerHTML=markup;return;}
    const source=new DOMParser().parseFromString(`<svg xmlns="${NS}">${markup}</svg>`,'image/svg+xml');
    if(source.querySelector('parsererror'))throw new Error('Invalid authored SVG markup.');
    const copy=node=>{
      if(node.nodeType===3)return document.createTextNode(node.textContent);
      const out=document.createElementNS(NS,node.localName);
      [...node.attributes].forEach(a=>out.setAttribute(a.name,a.value));
      [...node.childNodes].forEach(child=>out.append(copy(child)));return out;
    };
    svg.replaceChildren(...[...source.documentElement.childNodes].map(copy));
    svg.querySelectorAll('.m-node').forEach(group=>{
      const box=group.querySelector('rect');if(!box)return;
      const right=Number(box.getAttribute('x')||0)+Number(box.getAttribute('width'));
      group.querySelectorAll('text').forEach(text=>{
        const x=Number(text.getAttribute('x')||0),center=text.getAttribute('text-anchor')==='middle';
        const available=center?Number(box.getAttribute('width'))-32:right-x-16;
        if(available>0){text.dataset.fitWidth=String(available);text.dataset.fitFontSize=text.getAttribute('font-size')||'16';}
      });
    });
    // Canvas measurements keep the authored node padding, including after font loading.
    window.ContextMotion?.fitText(svg);
  }
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
      router: "A chosen model returns typed decisions inside an externally governed harness"
    };
    const descriptions = {
      cover: "Original sources link to structured memory, which supplies the current task context. Replaceable model, search and tool adapters consume this context. A permission boundary governs every layer. This is an unimplemented architecture proposal.",
      pipeline: "Capture preserves the original source. Propose creates candidate claims, not verified facts. A policy gate controls validation. Validate checks evidence, conflicts and scope before commit stores admitted claims with status. This is an unimplemented architecture proposal.",
      memory: "Original sources supply structured memory, rebuildable indexes and summaries, and the working task context. Correction or invalidation starts by checking the source, preserves original records, and rebuilds affected derived views under existing access and retention rules. Authority applies at every layer; a rebuilt view cannot grant permission. This is an unimplemented architecture proposal.",
      router: "The application asks a defined judgment. A chosen model returns Choice, yes/no or rubric Score. The harness checks the schema, evidence and allowed operations. A model output cannot grant permission or approve new meaning. Calibration requires evaluation. This is a proposed decision interface."
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
      captureGroup(0, () => box(111, 34, 298, 61, "Defined judgment", "Evidence · schema · allowed values"), "Define the judgment", "Specify the question, allowed output values and evidence. Keep policy authority outside the model.");
      captureGroup(1, () => box(132, 152, 256, 66, "Model + harness", "Checked typed outputs", true), "Bounded model interface", "The chosen model returns a typed judgment. Application code validates the schema, evidence and allowed operations.");
      captureGroup(2, () => box(27, 283, 138, 62, "Choice", "One category"), "Choice signal", "Select one label from an allowed list, such as a semantic layer. A selected label is a proposal rather than human approval.");
      captureGroup(3, () => {
        add(rect(191, 283, 138, 62));
        add(text(260, 307, "Yes / no", 17, C.ink, "middle", 600));
        add(text(260, 330, "Defined condition", 15, C.blue));
      }, "Yes/no signal", "Judge a defined condition against evidence. Deterministic application policy still enforces authorization.");
      captureGroup(4, () => box(355, 283, 138, 62, "Rubric score", "Stated criteria"), "Rubric score", "Rate a property against stated criteria. A score is not automatically a probability. Reported probabilities require calibration checks.");
      add(text(260, 362, "A model cannot grant itself permission.", 15));
      footer();
    }
    draw(svg,markup);
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
    const text = (x, y, value, size = 20, fill = "var(--ink, #000000)", anchor = "start", weight = 500) => `<text x="${x}" y="${y}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}">${esc(value)}</text>`;
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
            rectangle(x,y,240,112,'#ffffff',color)+text(x+17,y+27,s.name.toUpperCase(),16,color,'start',700)+text(x+17,y+66,copy[0],22,'#000000','start',700)+text(x+17,y+94,copy[1],15,'#6F7171'));
          return;
        }
        const brief = { telecom: "Traffic growth", utilities: "Queued renewables", healthcare: "Receive / integrate", hospitality: "Staffing shortages" }[s.id];
        markup += node(i, s.name, s.solution,
          rectangle(x, y, 240, 112, "#ffffff", color) + text(x + 17, y + 27, s.shortName.toUpperCase(), 16, color, "start", 700) + text(x + 17, y + 69, s.metric.value, 34, "#000000", "start", 700) + text(x + 17, y + 94, brief, 17, "#6F7171"));
      });
      markup += node(4, kind === 'product' ? 'Prefrontal · governed context' : "Shared checks, separate vaults", kind === 'product' ? 'One proposed context foundation. Configure each workflow. Prove its value and boundaries in a measured pilot.' : "Link evidence for one authorized task. Preserve time, conditions and authority. Keep industry and project records separate.", rectangle(267, 206, 186, 100, "#F6F6F6", "var(--cyan, #53c8d8)", 22) + text(360, 240, kind === 'product' ? 'Prefrontal' : "Governed", 24, "#000000", "middle", 700) + text(360, 269, "context", 24, "#000000", "middle", 700) + text(360, 290, "EVIDENCE + OWNER", 11, "#000000", "middle", 600));
      markup += text(360, 493, kind === 'product' ? 'Product objectives · measured in the pilot' : "Shared checks do not mean shared private records.", 16, "#6F7171", "middle");
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
    draw(svg,markup);
    return svg;
  }
  function createArchitecture(plan) {
    const id = `context-architecture-${++render}`;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${plan.viewBox[0]} ${plan.viewBox[1]}`);
    svg.setAttribute('class', 'motion-diagram architecture-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-labelledby', `${id}-title ${id}-desc`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const text = (x,y,value,size=15,fill=C.ink,weight=500) => `<text x="${x}" y="${y}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(value)}</text>`;
    let markup = `<title id="${id}-title">Full proposed Prefrontal product: submissions, human governance, canonical IDs, model harness, four layers, MCP delivery and feedback</title><desc id="${id}-desc">${esc(plan.stages.map(stage=>stage.detail).join(' '))} ${esc(plan.legend)}</desc><defs><marker id="${id}-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1 L9 5 L1 9 Z" fill="${C.blue}"/></marker><marker id="${id}-return" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1 L9 5 L1 9 Z" fill="${C.gold}"/></marker></defs>`;
    markup += `<g data-policy="external"><rect x="24" y="4" width="1212" height="40" rx="8" fill="${C.navy}"/>${text(38,29,plan.policy.title,16,C.white,650)}${text(482,29,plan.policy.detail,15,C.cyan)}</g>`;
    markup += text(24,66,'SUBMISSION → HUMAN APPROVAL → CANONICAL IDENTITY',13,C.blue,650);
    markup += text(750,270,'APPROVED RELEASE → PERMITTED OUTPUT',13,C.blue,650);
    for (const edge of plan.edges) {
      const color = edge.dashed ? C.gold : C.blue;
      markup += `<g class="m-edge m-stage" data-step="${edge.step}" data-edge="${esc(edge.id)}"><path id="${id}-${esc(edge.id)}" d="${esc(edge.path)}" fill="none" stroke="${color}" stroke-width="2" ${edge.dashed?'stroke-dasharray="6 5"':''} marker-end="url(#${id}-${edge.dashed?'return':'arrow'})"/><circle class="m-dot" r="4" fill="${edge.dashed?C.gold:C.cyan}" stroke="${C.white}" stroke-width="1"><animateMotion dur="1.6s" repeatCount="indefinite"><mpath href="#${id}-${esc(edge.id)}"/></animateMotion></circle></g>`;
    }
    plan.stages.forEach((stage,step) => {
      markup += `<g class="m-node m-stage" data-step="${step}" data-stage="${esc(stage.title)}" data-stage-detail="${esc(stage.detail)}">`;
      plan.nodes.filter(node=>node.step===step).forEach(node => {
        const {x,y,width,height} = node;
        const compact = height<60;
        const titleSize = width<200?17:18;
        const titleBaseline = width<200?24:25;
        const firstLine = compact || node.id==='writeback' ? 47 : 46;
        markup += `<g data-node="${esc(node.id)}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="9" fill="${node.dark?C.navy:C.white}" stroke="${C.blue}" stroke-width="1.5"/>${text(x+12,y+titleBaseline,node.title,titleSize,node.dark?C.white:C.ink,650)}`;
        node.lines.forEach((line,index) => { markup += text(x+12,y+firstLine+index*22,line,15,node.dark?C.white:C.muted); });
        markup += '</g>';
      });
      markup += '</g>';
    });
    markup += `<g data-review="owner"><rect x="24" y="526" width="1212" height="24" rx="5" fill="${C.canvas}" stroke="${C.gold}"/>${text(36,543,plan.review,14,C.ink)}</g>`;
    draw(svg,markup);
    return svg;
  }
  function createProductFlow(plan) {
    const id=`context-product-flow-${++render}`;
    const svg=document.createElementNS(NS,'svg');
    svg.setAttribute('viewBox','0 0 1000 180');svg.setAttribute('class','motion-diagram product-flow-svg');svg.setAttribute('role','img');
    svg.setAttribute('aria-labelledby',`${id}-title ${id}-desc`);svg.setAttribute('preserveAspectRatio','xMidYMid meet');
    let markup=`<title id="${id}-title">${esc(plan.title)}</title><desc id="${id}-desc">${esc(plan.nodes.map(n=>n.detail).join(' '))} Proposed design, not a running product.</desc><defs><marker id="${id}-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1 L9 5 L1 9 Z" fill="${C.blue}"/></marker></defs>`;
    plan.nodes.forEach((n,i)=>{
      const x=20+i*250;
      if(i>0)markup+=`<g class="m-edge m-stage" data-step="${i}"><path id="${id}-edge-${i}" d="M${x-30} 83 H${x}" fill="none" stroke="${C.blue}" stroke-width="2" marker-end="url(#${id}-arrow)"/><circle class="m-dot" r="4" fill="${C.cyan}"><animateMotion dur="1.6s" repeatCount="indefinite"><mpath href="#${id}-edge-${i}"/></animateMotion></circle></g>`;
      const text=(y,v,size,fill,weight=500)=>`<text x="${x+14}" y="${y}" font-family="Segoe UI,Arial,sans-serif" font-size="${size}" fill="${fill}" font-weight="${weight}">${esc(v)}</text>`;
      markup+=`<g class="m-node m-stage" data-node="${esc(n.id)}" data-step="${i}" data-stage="${esc(n.title)}" data-stage-detail="${esc(n.detail)}"><rect x="${x}" y="28" width="220" height="110" rx="10" fill="${i===2?C.navy:C.white}" stroke="${C.blue}" stroke-width="1.5"/>${text(55,n.title,18,i===2?C.white:C.ink,650)}${n.lines.map((line,j)=>text(82+j*23,line,15,i===2?C.white:C.blue)).join('')}</g>`;
    });
    svg.innerHTML=markup;return svg;
  }
  function createInfographic(plan) {
    const counts = { cycle: [4], hub: [4], matrix: [4, 6, 8], timeline: [7] };
    if (!plan || !counts[plan.layout] || !Array.isArray(plan.stages) || !counts[plan.layout].includes(plan.stages.length)) {
      throw new Error('Infographic needs a supported layout and its required number of stages.');
    }
    if (plan.layout === 'hub' && !plan.center) throw new Error('A relationship infographic needs a center record.');
    const keys = new Set();
    for (const stage of plan.stages) {
      if (!stage.id || keys.has(stage.id) || !stage.title || !Array.isArray(stage.lines) || stage.lines.length > 2) {
        throw new Error('Infographic stages need unique IDs, titles and no more than two visible lines.');
      }
      keys.add(stage.id);
    }
    if (plan.center && (!plan.center.title || !Array.isArray(plan.center.lines) || plan.center.lines.length > 2)) {
      throw new Error('An infographic center needs a title and no more than two visible lines.');
    }
    const id = `context-infographic-${++render}`;
    const svg = document.createElementNS(NS, 'svg');
    const projected=plan.projection===true;
    const bottom=projected?40:0;
    svg.setAttribute('viewBox', plan.compact ? '0 0 1000 180' : projected?'0 0 1000 300':'0 0 1000 340');
    svg.setAttribute('class', `motion-diagram infographic-svg infographic-${plan.layout}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-labelledby', `${id}-title ${id}-desc`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const ink = 'var(--ink, #000000)', red = 'var(--red, #EE001E)', paper = 'var(--paper, #ffffff)';
    const muted = 'var(--muted, #6F7171)', mist = 'var(--mist, #F6F6F6)', lineColor = 'var(--line, #D8DADA)';
    const text = (x, y, value, size = 15, fill = ink, weight = 500, anchor = 'start') => `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(value)}</text>`;
    const rect = (x, y, width, height, fill = paper, stroke = lineColor) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    // These pictograms express the record, check, role or method in each stage.
    // The browser animates only real transfer paths; relationship grids remain still.
    const pictures = {
      source: '<path d="M7 3h12l6 6v20H7z M19 3v7h6 M11 15h10 M11 20h10 M11 25h7"/>',
      check: '<rect x="4" y="4" width="24" height="24" rx="4"/><path d="m9 16 5 5 10-11"/>',
      link: '<path d="m13 10 4-4a7 7 0 0 1 10 10l-4 4 M19 22l-4 4A7 7 0 0 1 5 16l4-4 M11 21l10-10"/>',
      access: '<path d="M16 3 27 7v9c0 6-5 10-11 13C10 26 5 22 5 16V7z"/><rect x="11" y="13" width="10" height="9" rx="2"/><path d="M13 13v-3a3 3 0 0 1 6 0v3 M16 17v2"/>',
      code: '<path d="m10 8-7 8 7 8 M22 8l7 8-7 8 M19 4l-6 24"/>',
      cache: '<ellipse cx="14" cy="6" rx="10" ry="4"/><path d="M4 6v16c0 5 14 6 19 2 M4 14c0 5 20 5 20 0 M24 6v8 M22 15a8 8 0 1 1-6 14 M22 15v6h6"/>',
      model: '<path d="M13 5a5 5 0 0 0-8 5 5 5 0 0 0-1 9 6 6 0 0 0 9 8 M19 5a5 5 0 0 1 8 5 5 5 0 0 1 1 9 6 6 0 0 1-9 8 M16 3v26 M8 11l8 5 8-5 M9 23l7-7 7 7"/><circle cx="16" cy="16" r="3"/>',
      data: '<ellipse cx="16" cy="6" rx="11" ry="4"/><path d="M5 6v19c0 5 22 5 22 0V6 M5 15c0 5 22 5 22 0 M5 23c0 5 22 5 22 0"/>',
      cost: '<circle cx="16" cy="16" r="13"/><path d="M21 10h-7a4 4 0 0 0 0 8h4a4 4 0 0 1 0 8h-7 M16 5v23"/>',
      human: '<circle cx="16" cy="9" r="6"/><path d="M5 29v-5c0-11 22-11 22 0v5 M10 29v-6 M22 29v-6"/>',
      tool: '<path d="M28 5 21 12l-5-5 7-7a10 10 0 0 0-13 12L2 25a4 4 0 0 0 5 5l12-10A10 10 0 0 0 28 5z"/>',
      clock: '<circle cx="16" cy="16" r="13"/><path d="M16 8v9l7 4 M16 3v2 M29 16h-2 M16 29v-2 M3 16h2"/>',
      update: '<path d="M26 11A12 12 0 0 0 5 8L2 12 M2 4v8h8 M6 21a12 12 0 0 0 21 3l3-4 M30 28v-8h-8"/>',
      approve: '<circle cx="16" cy="16" r="13"/><path d="m8 16 6 6 11-12"/>'
    };
    const icon = (name, x, y, size = 30) => {
      if (!pictures[name]) throw new Error(`Unknown infographic icon: ${name}`);
      return `<g class="infographic-icon" transform="translate(${x} ${y}) scale(${size / 32})" fill="none" stroke="${red}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${pictures[name]}</g>`;
    };
    let markup = `<title id="${id}-title">${esc(plan.title)}</title><desc id="${id}-desc">${esc(plan.summary || '')} ${esc(plan.stages.map(stage => stage.detail || stage.title).join(' '))}</desc><defs><marker id="${id}-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1 L9 5 L1 9 Z" fill="${ink}"/></marker></defs>`;
    const edge = (step, path, name, directed = true) => {
      markup += `<g class="m-edge m-stage" data-step="${step}" data-edge="${esc(name)}"><path id="${id}-${esc(name)}" d="${path}" fill="none" stroke="${directed ? ink : lineColor}" stroke-width="2" ${directed ? `marker-end="url(#${id}-arrow)"` : ''}/>`;
      if (directed) markup += `<circle class="m-dot" r="4" fill="${red}"><animateMotion dur="1.6s" repeatCount="indefinite" calcMode="linear"><mpath href="#${id}-${esc(name)}"/></animateMotion></circle>`;
      markup += '</g>';
    };
    const node = (stage, index, position) => {
      const { x, y, width, height, wide = false } = position;
      const titleX = x + (wide ? 94 : 54);
      const labelX = wide ? titleX : x + 16;
      const titleY = y + (wide ? 42 : 33);
      const firstY = y + (wide ? 75 : 66);
      markup += `<g class="m-node m-stage" data-node="${esc(stage.id)}" data-step="${index}" data-stage="${esc(stage.title)}" data-stage-detail="${esc(stage.detail || '')}">${rect(x, y, width, height)}${icon(stage.icon || 'source', x + 16, y + (wide ? 35 : 12), wide ? 52 : 28)}${text(titleX, titleY, stage.title, 19, ink, 700)}`;
      stage.lines.forEach((value, i) => { markup += text(labelX, firstY + i * 23, value, 15, muted); });
      markup += '</g>';
    };
    const center = (x, y, width, height) => {
      if (!plan.center) return;
      const mid = x + width / 2;
      markup += `<g class="infographic-center" data-center="record">${rect(x, y, width, height, mist, red)}${text(mid, y + 27, plan.center.title, 19, ink, 700, 'middle')}`;
      plan.center.lines.forEach((value, index) => { markup += text(mid, y + 49 + index * 20, value, 14, muted, 500, 'middle'); });
      markup += '</g>';
    };
    if (plan.layout === 'cycle') {
      const positions = [{ x: 30, y: 15 }, { x: 660, y: 15 }, { x: 660, y: 221-bottom }, { x: 30, y: 221-bottom }];
      edge(1, 'M340 67 H660', 'first-next');
      edge(2, `M815 119 V${221-bottom}`, 'second-next');
      edge(3, `M660 ${273-bottom} H340`, 'third-next');
      edge(0, `M185 ${221-bottom} V119`, 'return-work');
      plan.stages.forEach((stage, index) => node(stage, index, { ...positions[index], width: 310, height: 104 }));
      center(350, 131-bottom/2, 300, 78);
    } else if (plan.layout === 'hub') {
      const positions = [{ x: 20, y: 20 }, { x: 670, y: 20 }, { x: 670, y: 216-bottom }, { x: 20, y: 216-bottom }];
      const paths = [`M330 72 H368 V${145-bottom/2} H385`, `M670 72 H632 V${145-bottom/2} H615`, `M670 ${268-bottom} H632 V${191-bottom/2} H615`, `M330 ${268-bottom} H368 V${191-bottom/2} H385`];
      paths.forEach((path, index) => edge(index, path, `record-link-${index}`, false));
      plan.stages.forEach((stage, index) => node(stage, index, { ...positions[index], width: 310, height: 104 }));
      center(385, 124-bottom/2, 230, 88);
    } else if (plan.layout === 'matrix') {
      const columns = plan.compact ? 4 : plan.stages.length / 2;
      const width = columns === 2 ? 460 : columns === 3 ? 300 : 225;
      const gap = columns === 2 ? 40 : columns === 3 ? 30 : 20;
      plan.stages.forEach((stage, index) => node(stage, index, {
        x: 20 + (index % columns) * (width + gap), y: index < columns ? 15 : 185-bottom,
        width, height: 140, wide: columns === 2
      }));
    } else {
      const positions = [20, 265, 510, 755].map(x => ({ x, y: 20 }));
      positions.push(...[755, 510, 265].map(x => ({ x, y: 205-bottom })));
      for (let index = 1; index < positions.length; index++) {
        const before = positions[index - 1], after = positions[index];
        const path = index < 4 ? `M${before.x + 225} 77 H${after.x}`
          : index === 4 ? `M867.5 134 V${205-bottom}`
            : `M${before.x} ${262-bottom} H${after.x + 225}`;
        edge(index, path, `delivery-${index}`);
      }
      plan.stages.forEach((stage, index) => node(stage, index, { ...positions[index], width: 225, height: 114 }));
    }
    draw(svg,markup);
    return svg;
  }
  function createTokenCost(plan) {
    if (!plan || !Array.isArray(plan.stages) || plan.stages.length !== 3) {
      throw new Error('A token-volume infographic needs exactly three cases.');
    }
    const keys = new Set();
    const totals = plan.stages.map(stage => {
      if (!stage.id || keys.has(stage.id) || !stage.title || !Number.isSafeInteger(stage.calls) || stage.calls < 1 ||
          !Number.isSafeInteger(stage.inputTokens) || stage.inputTokens < 0 || !Number.isSafeInteger(stage.outputTokens) || stage.outputTokens < 0) {
        throw new Error('Token cases need unique IDs, titles, positive call counts and non-negative whole token counts.');
      }
      keys.add(stage.id);
      return stage.inputTokens + stage.outputTokens;
    });
    const scaleMax = Math.max(...totals);
    if (!Number.isSafeInteger(scaleMax) || scaleMax < 1) throw new Error('A token-volume infographic needs a positive total.');
    const id = `context-token-volume-${++render}`;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 1000 340');
    svg.setAttribute('class', 'motion-diagram infographic-svg token-cost-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-labelledby', `${id}-title ${id}-desc`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('data-scale-max', String(scaleMax));
    const ink = 'var(--ink, #000000)', red = 'var(--red, #EE001E)', muted = 'var(--muted, #6F7171)';
    const format = value => value.toLocaleString('en-US');
    const text = (x, y, value, size = 15, fill = ink, weight = 500) => `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(value)}</text>`;
    let markup = `<title id="${id}-title">${esc(plan.title)}</title><desc id="${id}-desc">${esc(plan.summary || '')} ${esc(plan.stages.map((stage, index) => `${stage.title}: ${stage.calls} calls, ${stage.inputTokens} input tokens, ${stage.outputTokens} output tokens, ${totals[index]} total tokens. ${stage.detail || ''}`).join(' '))} All three bars use the same token scale. Illustrative token volume, not price.</desc>`;
    plan.stages.forEach((stage, index) => {
      const y = 12 + index * 97;
      const inputWidth = stage.inputTokens / scaleMax * 620;
      const outputWidth = stage.outputTokens / scaleMax * 620;
      markup += `<g class="m-node m-stage" data-node="${esc(stage.id)}" data-step="${index}" data-stage="${esc(stage.title)}" data-stage-detail="${esc(stage.detail || '')}"><rect x="20" y="${y}" width="960" height="91" rx="12" fill="var(--paper, #ffffff)" stroke="var(--line, #D8DADA)" stroke-width="1.5"/>${text(40, y + 27, stage.title, 19, ink, 700)}${text(40, y + 52, `${stage.calls} ${stage.calls === 1 ? 'call' : 'calls'} · ${format(totals[index])} tokens`, 15, muted)}`;
      markup += `<g class="token-bar"><rect class="token-bar-input" data-token-part="input" data-value="${stage.inputTokens}" x="335" y="${y + 24}" width="${inputWidth}" height="20" fill="${ink}"/><rect class="token-bar-output" data-token-part="output" data-value="${stage.outputTokens}" x="${335 + inputWidth}" y="${y + 24}" width="${outputWidth}" height="20" fill="${red}"/></g>${text(335, y + 70, `Input ${format(stage.inputTokens)}  +  output ${format(stage.outputTokens)}`, 15, muted)}</g>`;
    });
    markup += `<rect x="28" y="318" width="13" height="13" fill="${ink}"/>${text(48, 330, 'Input', 14)}<rect x="111" y="318" width="13" height="13" fill="${red}"/>${text(131, 330, 'Output', 14)}${text(260, 330, 'Illustrative token volume, not price', 15, muted)}`;
    draw(svg,markup);
    return svg;
  }
  return Object.freeze({ create, createIndustry, createArchitecture, createProductFlow, createInfographic, createTokenCost });
})();
