/* Shared SVG motion and text measurement.
 * Adapted from src/anim.js and src/svg.js in the user-supplied vz-motion-kit.zip.
 * One requestAnimationFrame dispatcher serves all visible, allowed figures.
 */
(function (global) {
  "use strict";

  const doc = typeof document === "undefined" ? null : document;
  const items = new Set();
  const byElement = new WeakMap();
  const baseFonts = new WeakMap();
  const media = typeof global.matchMedia === "function"
    ? global.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
  let paused = false;
  let reduced = Boolean(media?.matches);
  let raf = null;
  let frames = 0;
  let canvasContext;

  const connected = item => item.element.isConnected !== false;
  const eligible = item => !item.disposed && !item.done && item.allowed
    && item.visible && connected(item) && !paused && !reduced && !doc?.hidden;

  function stop() {
    if (raf !== null && typeof global.cancelAnimationFrame === "function") {
      global.cancelAnimationFrame(raf);
    }
    raf = null;
    items.forEach(item => { item.last = null; });
  }

  function reconcile() {
    let active = false;
    items.forEach(item => {
      if(item.element.dataset) item.element.dataset.playing=String(eligible(item));
      if (eligible(item)) active = true;
      else item.last = null;
    });
    if (!active) stop();
    else if (raf === null && typeof global.requestAnimationFrame === "function") {
      raf = global.requestAnimationFrame(tick);
    }
  }

  function tick(now) {
    raf = null;
    frames += 1;
    items.forEach(item => {
      if (!eligible(item)) {
        item.last = null;
        return;
      }
      const delta = item.last === null ? 0 : Math.max(0, (now - item.last) / 1000);
      item.last = now;
      item.elapsed += delta;
      try {
        if (item.frame(item.elapsed, delta) === "done") item.done = true;
      } catch (error) {
        item.done = true;
        global.console?.error("Context diagram motion stopped after a frame error.", error);
      }
    });
    reconcile();
  }

  const observer = typeof global.IntersectionObserver === "function"
    ? new global.IntersectionObserver(entries => {
      entries.forEach(entry => {
        const item = byElement.get(entry.target);
        if (item) item.visible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
      });
      reconcile();
    }, { threshold: [0, 0.25] })
    : null;

  function drawStatic() {
    items.forEach(item => {
      if (!connected(item) || !item.staticFrame) return;
      try { item.staticFrame(); }
      catch (error) {
        global.console?.error("Context diagram static frame could not be drawn.", error);
      }
    });
  }

  function register({ element, frame, staticFrame }) {
    if (!element || typeof frame !== "function") {
      throw new TypeError("A motion registration needs an element and a frame function.");
    }
    const previous = byElement.get(element);
    if (previous) previous.controller.dispose();
    const item = {
      element, frame, staticFrame, allowed: false, visible: !observer,
      elapsed: 0, last: null, done: false, disposed: false, controller: null
    };
    const controller = {
      setAllowed(value) {
        if (item.disposed) return;
        const allowed = Boolean(value);
        if (allowed !== item.allowed) item.last = null;
        item.allowed = allowed;
        reconcile();
      },
      dispose() {
        if (item.disposed) return;
        item.disposed = true;
        items.delete(item);
        observer?.unobserve(element);
        if (byElement.get(element) === item) byElement.delete(element);
        reconcile();
      }
    };
    item.controller = controller;
    items.add(item);
    byElement.set(element, item);
    observer?.observe(element);
    if ((paused || reduced) && staticFrame) staticFrame();
    return controller;
  }

  function setPaused(value) {
    const next = Boolean(value);
    const changed = next !== paused;
    paused = next;
    if (paused) {
      stop();
      if (changed) drawStatic();
    } else {
      if (changed) items.forEach(item => { item.done = false; });
      reconcile();
    }
  }

  function setReduced(value) {
    const next = Boolean(value);
    const changed = next !== reduced;
    reduced = next;
    if (reduced) {
      stop();
      if (changed) drawStatic();
    } else {
      if (changed) items.forEach(item => { item.done = false; });
      reconcile();
    }
  }

  if (media?.addEventListener) media.addEventListener("change", event => setReduced(event.matches));
  else if (media?.addListener) media.addListener(event => setReduced(event.matches));
  doc?.addEventListener?.("visibilitychange", reconcile);

  function fontOptions(options = {}) {
    const size = Number.parseFloat(options.fontSize);
    return {
      fontSize: Number.isFinite(size) && size > 0 ? size : 16,
      fontFamily: options.fontFamily || "Arial, sans-serif",
      fontWeight: options.fontWeight || 500
    };
  }

  function context() {
    if (canvasContext !== undefined) return canvasContext;
    canvasContext = null;
    try { canvasContext = doc?.createElement?.("canvas")?.getContext?.("2d") || null; }
    catch (_) { /* A DOM-less static build uses the width approximation below. */ }
    return canvasContext;
  }

  function measure(text, options) {
    const value = String(text ?? "");
    const font = fontOptions(options);
    const canvas = context();
    if (canvas) {
      canvas.font = `${font.fontWeight} ${font.fontSize}px ${font.fontFamily}`;
      return canvas.measureText(value).width;
    }
    // Approximate only when canvas is unavailable. Browser acceptance uses canvas.
    return [...value].reduce((width, letter) => width + (/\s/.test(letter) ? 0.3
      : /[ilI.,'!:;|]/.test(letter) ? 0.28 : /[MW@%]/.test(letter) ? 0.9 : 0.56), 0) * font.fontSize;
  }

  function wrap(text, maxWidth, options) {
    const width = Number(maxWidth);
    if (!Number.isFinite(width) || width <= 0) return [String(text ?? "")];
    const lines = [];
    String(text ?? "").split(/\r?\n/).forEach(paragraph => {
      let line = "";
      const words = paragraph.split(/\s+/).filter(Boolean);
      words.forEach(word => {
        const next = line ? `${line} ${word}` : word;
        if (line && measure(next, options) > width) {
          lines.push(line);
          line = word;
        } else line = next;
      });
      lines.push(line);
    });
    return lines;
  }

  function fitText(svg) {
    const overflow = [];
    svg.querySelectorAll("text[data-fit-width]").forEach(node => {
      const available = Number(node.getAttribute("data-fit-width"));
      if (!(available > 0)) return;
      if (!baseFonts.has(node)) {
        const style = typeof global.getComputedStyle === "function" ? global.getComputedStyle(node) : {};
        baseFonts.set(node, fontOptions({
          fontSize: node.getAttribute("data-fit-font-size") || style.fontSize || node.getAttribute("font-size"),
          fontFamily: style.fontFamily || node.getAttribute("font-family"),
          fontWeight: style.fontWeight || node.getAttribute("font-weight")
        }));
      }
      const font = baseFonts.get(node);
      const spans = [...node.querySelectorAll("tspan")];
      const lines = spans.length ? spans.map(span => span.textContent) : [node.textContent];
      const measured = Math.max(...lines.map(line => measure(line, font)), 0);
      const desired = measured > available ? font.fontSize * available / measured : font.fontSize;
      const minimum = Number(node.getAttribute("data-fit-min-size")) || Math.min(14, font.fontSize);
      const size = Math.max(minimum, desired);
      node.style.fontSize = `${size}px`;
      const clipped = measured * size / font.fontSize > available + 0.5;
      node.setAttribute("data-fit-overflow", String(clipped));
      if (clipped) overflow.push({ text: node.textContent, available, measured, minimum });
    });
    return overflow;
  }

  global.ContextMotion = {
    register, setPaused, setReduced, measure, wrap, fitText,
    stats() {
      return { scheduled: raf !== null, active: [...items].filter(eligible).length,
        frames, registrations: items.size };
    }
  };
})(typeof window === "undefined" ? globalThis : window);
