import test from 'node:test';
import assert from 'node:assert/strict';
import { tryOpenPaletteOverlay, dispatchOverlayMessage, dismissOverlaySession } from '../extension/palette-overlay.js';

function fixture() {
  const store = {};
  const messages = [];
  const calls = [];
  const api = {
    runtime: { id: 'ama', getURL: path => `chrome-extension://ama/${path}` },
    storage: { session: {
      async get(key) { return { [key]: structuredClone(store[key]) }; },
      async set(values) { Object.assign(store, structuredClone(values)); },
      async remove(key) { delete store[key]; },
    } },
    tabs: { async query() { return [{ id: 7, windowId: 1, url: 'https://example.com/', active: true }]; },
      async sendMessage(tabId, message, options) { messages.push({ tabId, message, options }); return { ok: true }; } },
    scripting: { async executeScript(options) { calls.push(options); return [{ result: true }]; } },
  };
  const sender = token => ({ id: 'ama', url: `chrome-extension://ama/palette.html?windowId=1&overlayToken=${token}`,
    tab: { id: 7, windowId: 1 }, frameId: 4, documentId: 'frame-document' });
  return { api, store, messages, calls, sender };
}

test('a supported page gets an isolated overlay session instead of a new window', async () => {
  const env = fixture();
  const opened = await tryOpenPaletteOverlay(env.api, 1);
  assert.equal(opened.mode, 'overlay');
  assert.equal(opened.tabId, 7);
  const [url, token] = env.calls[0].args;
  assert.equal(new URL(url).searchParams.get('overlayToken'), token);
  assert.equal(env.store['amaPalette:7'].token, token);
  assert.deepEqual(env.calls[0].target, { tabId: 7 });
});
test('restricted pages and missing injection permission fall back without leaving a session', async () => {
  const env = fixture();
  env.api.scripting.executeScript = async () => { throw new Error('Cannot access contents of url'); };
  assert.equal(await tryOpenPaletteOverlay(env.api, 1), null);
  assert.deepEqual(env.store, {});
  env.api.tabs.query = async () => [{ id: 7, windowId: 1, url: 'chrome://settings/' }];
  assert.equal(await tryOpenPaletteOverlay(env.api, 1), null);
  assert.deepEqual(env.store, {});
});
test('an iframe that never becomes ready falls back and clears its session', async () => {
  const env = fixture();
  env.api.scripting.executeScript = async () => [{ result: false }];
  assert.equal(await tryOpenPaletteOverlay(env.api, 1), null);
  assert.deepEqual(env.store, {});
});
test('cancelling before readiness does not launch the popup fallback', async () => {
  const env = fixture();
  env.api.scripting.executeScript = async () => [{ result: 'cancelled' }];
  assert.deepEqual(await tryOpenPaletteOverlay(env.api, 1), { mode: 'dismissed' });
  assert.deepEqual(env.store, {});
});
test('only the registered token, tab, window and frame document may use overlay commands', async () => {
  const env = fixture();
  await tryOpenPaletteOverlay(env.api, 1);
  const { token } = env.store['amaPalette:7'];
  const message = { type: 'READ', windowId: 1, overlayToken: token };
  const dispatch = async value => value;
  assert.equal((await dispatchOverlayMessage(env.api, message, env.sender(token), dispatch)).windowId, 1);
  for (const sender of [
    { ...env.sender(token), id: 'foreign' }, { ...env.sender(token), frameId: 0 },
    { ...env.sender(token), tab: { id: 8, windowId: 1 } }, { ...env.sender(token), tab: { id: 7, windowId: 2 } },
    { ...env.sender(token), documentId: 'another-document' }, { ...env.sender(token), url: 'https://example.com/' },
  ]) await assert.rejects(dispatchOverlayMessage(env.api, message, sender, dispatch));
  await assert.rejects(dispatchOverlayMessage(env.api, { ...message, overlayToken: 'forged' }, env.sender(token), dispatch));
  await assert.rejects(dispatchOverlayMessage(env.api, { ...message, windowId: 2 }, env.sender(token), dispatch));
  await assert.rejects(dispatchOverlayMessage(env.api, { ...message, type: 'EXPORT' }, env.sender(token), dispatch));
});
test('closing an overlay removes only its host and never closes a Chrome window', async () => {
  const env = fixture();
  await tryOpenPaletteOverlay(env.api, 1);
  const { token } = env.store['amaPalette:7'];
  await dispatchOverlayMessage(env.api, { type: 'PALETTE_CLOSE', overlayToken: token, windowId: 1, restoreFocus: false }, env.sender(token), () => assert.fail('must not dispatch close to controller'));
  assert.deepEqual(env.messages.at(-1), { tabId: 7, message: { type: 'AMA_PALETTE_REMOVE', token, restoreFocus: false }, options: { frameId: 0 } });
  assert.deepEqual(env.store, {});
});
test('stale dismissals cannot remove a newly opened overlay session', async () => {
  const env = fixture();
  await tryOpenPaletteOverlay(env.api, 1);
  const old = env.store['amaPalette:7'].token;
  await tryOpenPaletteOverlay(env.api, 1);
  await dismissOverlaySession(env.api, { overlayToken: old }, { id: 'ama', frameId: 0, tab: { id: 7, windowId: 1 } });
  assert.notEqual(env.store['amaPalette:7'].token, old);
});
