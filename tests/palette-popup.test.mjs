import test from 'node:test';
import assert from 'node:assert/strict';
import { openPalette, dispatchPopupMessage } from '../extension/palette-window.js';

function fixture() {
  const stored = {};
  const removed = [];
  const windows = [{ id: 1, type: 'normal', width: 1000, height: 800 }];
  const api = {
    runtime: { id: 'ama', getURL: path => `chrome-extension://ama/${path}` },
    storage: { session: { async get(key) { return { [key]: structuredClone(stored[key]) }; },
      async set(values) { Object.assign(stored, structuredClone(values)); }, async remove(key) { delete stored[key]; } } },
    windows: { async get(id) { return windows.find(item => item.id === id); }, async getAll() { return windows; },
      async create(options) { const item = { ...options, id: 50, tabs: [{ id: 51, url: options.url }] }; windows.push(item); return item; },
      async remove(id) { removed.push(id); } },
  };
  return { api, stored, removed };
}
test('an uninvited top-level palette cannot read data or close a normal browser window', async () => {
  const env = fixture();
  const sender = { id: 'ama', frameId: 0, documentId: 'normal-tab', url: 'chrome-extension://ama/palette.html?windowId=1', tab: { id: 7, windowId: 1 } };
  for (const type of ['READ', 'PALETTE_CLOSE']) await assert.rejects(dispatchPopupMessage(env.api,
    { type, paletteWindowId: 1, windowId: 1 }, sender, () => assert.fail('uninvited command')));
  assert.deepEqual(env.removed, []);
});
test('only the created popup can execute and close through its bound parent session', async () => {
  const env = fixture();
  const popup = await openPalette(env.api, 1);
  const token = new URL(popup.tabs[0].url).searchParams.get('popupToken');
  assert.ok(token);
  const sender = { id: 'ama', frameId: 0, documentId: 'popup-document', url: popup.tabs[0].url, tab: { id: 51, windowId: 50 } };
  const message = { type: 'READ', popupToken: token, paletteWindowId: 50, windowId: 1 };
  assert.equal((await dispatchPopupMessage(env.api, message, sender, async request => request)).windowId, 1);
  assert.equal((await dispatchPopupMessage(env.api, message, { ...sender, documentId: 'reloaded-popup' }, async request => request)).windowId, 1, 'the owned popup remains usable after reload');
  await assert.rejects(dispatchPopupMessage(env.api, message, { ...sender, tab: { id: 7, windowId: 1 } }, () => assert.fail()));
  await dispatchPopupMessage(env.api, { ...message, type: 'PALETTE_CLOSE' }, sender, () => assert.fail());
  assert.deepEqual(env.removed, [50]);
  assert.deepEqual(env.stored, {});
});
