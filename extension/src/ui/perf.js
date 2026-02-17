/*
  This file is a tiny performance instrumentation helper for the editor UI.
  It exists separately so debug telemetry can evolve without cluttering application logic.
  It talks to browser timing primitives (`performance`, `requestAnimationFrame`) and logs
  only when the user explicitly enables debug mode through localStorage.
*/

const DEBUG_FLAG = 'corpusPerfDebug';

export function createPerfTracker({ now = () => performanceNow(), enabled = () => isDebugEnabled() } = {}) {
  let lastInputAtMs = 0;

  function markInput(label) {
    if (!enabled()) {
      return;
    }

    lastInputAtMs = now();
    log('input', { label, at: lastInputAtMs });
  }

  function markRender(label = 'render') {
    if (!enabled()) {
      return;
    }

    const renderStartMs = now();

    // We sample paint timing on the next frame to estimate user-perceived latency.
    requestAnimationFrame(() => {
      const paintMs = now();
      const inputToPaintMs = lastInputAtMs ? paintMs - lastInputAtMs : null;
      log('paint', {
        label,
        renderToPaintMs: roundMs(paintMs - renderStartMs),
        inputToPaintMs: inputToPaintMs === null ? null : roundMs(inputToPaintMs)
      });
    });
  }

  function markSync(event, details = {}) {
    if (!enabled()) {
      return;
    }

    log('sync', { event, ...details, at: now() });
  }

  return {
    markInput,
    markRender,
    markSync
  };
}

function isDebugEnabled() {
  try {
    return globalThis.localStorage?.getItem(DEBUG_FLAG) === '1';
  } catch {
    return false;
  }
}

function performanceNow() {
  return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
}

function roundMs(value) {
  return Math.round(Number(value) * 100) / 100;
}

function log(event, payload) {
  console.info(`[CorpusPerf] ${event}`, payload);
}
