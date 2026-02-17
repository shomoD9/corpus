/*
  This test file verifies lifecycle-triggered flush wiring.
  It exists to keep tab-hide and unload behavior deterministic and independent from UI rendering.
  It talks to `registerLifecycleFlush` through fake event targets.
*/

import test from 'node:test';
import assert from 'node:assert/strict';

import { registerLifecycleFlush } from '../src/ui/lifecycle_flush.js';

test('flushes on hidden visibility change, pagehide, and beforeunload', async () => {
  const events = [];
  const documentRef = new EventTarget();
  documentRef.visibilityState = 'visible';
  const windowRef = new EventTarget();

  const unregister = registerLifecycleFlush({
    documentRef,
    windowRef,
    onFlush: async (reason) => {
      events.push(reason);
    }
  });

  documentRef.visibilityState = 'hidden';
  documentRef.dispatchEvent(new Event('visibilitychange'));
  windowRef.dispatchEvent(new Event('pagehide'));
  windowRef.dispatchEvent(new Event('beforeunload'));
  unregister();

  assert.deepEqual(events, ['visibilitychange', 'pagehide', 'beforeunload']);
});

test('ignores visible visibility changes', () => {
  const events = [];
  const documentRef = new EventTarget();
  documentRef.visibilityState = 'visible';
  const windowRef = new EventTarget();

  registerLifecycleFlush({
    documentRef,
    windowRef,
    onFlush: async (reason) => {
      events.push(reason);
    }
  });

  documentRef.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(events, []);
});
