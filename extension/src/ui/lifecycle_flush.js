/*
  This file centralizes lifecycle-driven flush behavior for editor drafts.
  It exists separately from the UI renderer so event wiring remains small, testable, and reusable.
  It talks to `document` and `window` event streams and calls the injected `onFlush` callback
  whenever the page is likely to lose focus or unload.
*/

export function registerLifecycleFlush({
  documentRef = globalThis.document,
  windowRef = globalThis,
  onFlush = () => Promise.resolve()
} = {}) {
  if (typeof onFlush !== 'function') {
    return () => {};
  }

  const unsubs = [];

  const flushSafely = (reason) => {
    try {
      const result = onFlush(reason);
      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch {
      // Lifecycle hooks are best-effort; failures should never crash UI wiring.
    }
  };

  if (documentRef?.addEventListener) {
    const onVisibilityChange = () => {
      if (documentRef.visibilityState === 'hidden') {
        flushSafely('visibilitychange');
      }
    };

    documentRef.addEventListener('visibilitychange', onVisibilityChange);
    unsubs.push(() => documentRef.removeEventListener('visibilitychange', onVisibilityChange));
  }

  if (windowRef?.addEventListener) {
    const onPageHide = () => flushSafely('pagehide');
    const onBeforeUnload = () => flushSafely('beforeunload');

    windowRef.addEventListener('pagehide', onPageHide);
    windowRef.addEventListener('beforeunload', onBeforeUnload);

    unsubs.push(() => windowRef.removeEventListener('pagehide', onPageHide));
    unsubs.push(() => windowRef.removeEventListener('beforeunload', onBeforeUnload));
  }

  return () => {
    for (const unsub of unsubs) {
      unsub();
    }
  };
}
