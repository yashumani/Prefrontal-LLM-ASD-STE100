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
  return Object.freeze({ create });
})();
