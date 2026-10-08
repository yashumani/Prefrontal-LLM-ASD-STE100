/* Shared SVG motion and text measurement.
 * Adapted from src/anim.js and src/svg.js in the user-supplied vz-motion-kit.zip.
 * One requestAnimationFrame dispatcher serves all visible, allowed figures.
 */
(function (global) {
  "use strict";

  // Keep every motion cue with a smaller range. Timing belongs to consumers:
  // slowing packets must not delay stage selection or the shared frame clock.
  const profile = Object.freeze({
    name: 'calm',
    tiltDegrees: 1,
    liftPx: 4,
    packetSeconds: 2.4,
    stageSeconds: 2.4
  });
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
  let suspended = false;
  let depthRequested = true;
  let viewTransition = null;
  const listeners = new Set();
  const depthMedia = global.matchMedia?.('(min-width: 1101px)');
  const depthAvailable = () => !depthMedia || depthMedia.matches;
  const state = () => ({ paused, reduced, suspended, depthRequested,
    depthAvailable: depthAvailable(), stopped: paused || reduced || suspended || Boolean(doc?.hidden),
    depth: depthRequested && depthAvailable() && !paused && !reduced && !suspended });

  function notifyState() {
    const value = state();
    doc?.body?.classList.toggle('motion-paused', value.stopped);
    doc?.body?.classList.toggle('motion-reduced', reduced);
    if (doc?.body) doc.body.dataset.depth = value.depth ? 'on' : 'off';
    if (value.stopped) viewTransition?.skipTransition();
    listeners.forEach(listener => listener(value));
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(state());
    return () => listeners.delete(listener);
  }

  const connected = item => item.element.isConnected !== false;
  const eligible = item => !item.disposed && !item.done && item.allowed
    && item.visible && connected(item) && !paused && !reduced && !suspended && !doc?.hidden
    && (item.kind !== 'depth' || state().depth);

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
      const playing = eligible(item);
      if(item.element.dataset && item.element.dataset.playing !== String(playing)) item.element.dataset.playing=String(playing);
      if (playing && (item.continuous || item.dirty)) active = true;
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
    // Read layout for all dirty scenes before any frame writes visual state.
    items.forEach(item => {
      if (eligible(item) && item.dirty && item.measure) item.measurement = item.measure();
    });
    items.forEach(item => {
      if (!eligible(item) || (!item.continuous && !item.dirty)) {
        item.last = null;
        return;
      }
      const delta = item.last === null ? 0 : Math.max(0, (now - item.last) / 1000);
      item.last = now;
      item.elapsed += delta;
      try {
        if (item.frame(item.elapsed, delta, item.measurement) === "done") item.done = true;
        item.dirty = false;
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
        if (item) { item.visible = entry.isIntersecting && entry.intersectionRatio >= 0.25; item.dirty = true; }
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

  function register({ element, frame, staticFrame, measure, kind = 'flow', continuous = true }) {
    if (!element || typeof frame !== "function") {
      throw new TypeError("A motion registration needs an element and a frame function.");
    }
    const previous = byElement.get(element);
    if (previous) previous.controller.dispose();
    const item = {
      element, frame, staticFrame, measure, kind, continuous, dirty: true, allowed: false, visible: !observer,
      elapsed: 0, last: null, done: false, disposed: false, controller: null
    };
    const controller = {
      setAllowed(value) {
        if (item.disposed) return;
        const allowed = Boolean(value);
        if (allowed !== item.allowed) item.last = null;
        item.allowed = allowed;
        item.dirty = true;
        reconcile();
      },
      invalidate() { item.dirty = true; reconcile(); },
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

  function invalidateMeasurements() {
    items.forEach(item => { if (item.measure) item.dirty = true; });
    reconcile();
  }

  function setDepth(value) {
    depthRequested = Boolean(value);
    items.forEach(item => { if (item.kind === 'depth') { item.dirty = true; if (!state().depth) item.staticFrame?.(); } });
    notifyState();
    reconcile();
  }

  function setSuspended(value) {
    if (suspended === Boolean(value)) return;
    suspended = Boolean(value);
    if (suspended) { stop(); drawStatic(); }
    else invalidateMeasurements();
    notifyState();
    reconcile();
  }

  // Geometry is immutable between selections. Never query SVG paths each frame.
  function samplePath(path) {
    const length = path.getTotalLength();
    const count = Math.max(80, Math.min(400, Math.ceil(length / 10)));
    const points = Array.from({ length: count + 1 }, (_, i) => {
      const point = path.getPointAtLength(length * i / count);
      return [point.x, point.y];
    });
    return progress => {
      const f = Math.max(0, Math.min(1, progress)) * count;
      const i = Math.min(count - 1, Math.floor(f)), ratio = f - i;
      return { x: points[i][0] + (points[i + 1][0] - points[i][0]) * ratio,
        y: points[i][1] + (points[i + 1][1] - points[i][1]) * ratio };
    };
  }

  function arrive(element) {
    if (!element || state().stopped) return;
    element.classList.add('motion-arrival');
    element.addEventListener('animationend', () => element.classList.remove('motion-arrival'), { once: true });
  }

  function transition(update) {
    if (state().stopped || typeof doc?.startViewTransition !== 'function') { update(); return; }
    viewTransition?.skipTransition();
    const pending = doc.startViewTransition(update);
    viewTransition = pending;
    // Skipping an overtaken animation rejects ready; the state update still runs.
    pending.ready.catch(() => {});
    pending.finished.catch(() => {}).finally(() => { if (viewTransition === pending) viewTransition = null; });
  }

  function bindPauseControl(button) {
    button.addEventListener('click', () => setPaused(!paused));
    return subscribe(value => {
      button.disabled = value.reduced;
      button.setAttribute('aria-pressed', String(value.stopped));
      button.textContent = value.reduced ? 'Motion off' : value.paused ? 'Resume motion' : 'Pause motion';
    });
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
    if (changed) { invalidateMeasurements(); notifyState(); }
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
    if (changed) { invalidateMeasurements(); notifyState(); }
  }

  if (media?.addEventListener) media.addEventListener("change", event => setReduced(event.matches));
  else if (media?.addListener) media.addListener(event => setReduced(event.matches));
  doc?.addEventListener?.("visibilitychange", () => { notifyState(); reconcile(); });
  global.addEventListener?.('scroll', invalidateMeasurements, { passive: true });
  global.addEventListener?.('resize', invalidateMeasurements, { passive: true });
  depthMedia?.addEventListener?.('change', () => setDepth(depthRequested));

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
    profile,
    register, setPaused, setReduced, setSuspended, setDepth, state, subscribe,
    samplePath, arrive, transition, bindPauseControl, measure, wrap, fitText,
    stats() {
      return { scheduled: raf !== null, active: [...items].filter(eligible).length,
        frames, registrations: items.size,
        activeDepth: [...items].filter(item => item.kind === 'depth' && eligible(item)).length };
    }
  };
  notifyState();
})(typeof window === "undefined" ? globalThis : window);
