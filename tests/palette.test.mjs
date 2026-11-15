import test from 'node:test';
import assert from 'node:assert/strict';
import { inputIntent, paletteItems } from '../extension/palette-model.js';
import { openPalette } from '../extension/palette-window.js';
import { createState } from '../extension/core.js';

test('palette distinguishes HTTP URLs, bare domains and ordinary search text', () => {
  assert.deepEqual(inputIntent(' example.com/docs '), { kind: 'url', url: 'https://example.com/docs' });
  assert.deepEqual(inputIntent('https://example.com/a?q=1'), { kind: 'url', url: 'https://example.com/a?q=1' });
  assert.deepEqual(inputIntent('localhost:3000/test'), { kind: 'url', url: 'http://localhost:3000/test' });
  assert.deepEqual(inputIntent('chrome 插件开发'), { kind: 'search', text: 'chrome 插件开发' });
});
test('palette rejects unsafe schemes, credentials and empty navigation', () => {
  for (const value of ['javascript:alert(1)', 'file:///tmp/x', 'data:text/html,x', 'https://user:secret@example.com', '   ']) {
    assert.throws(() => inputIntent(value));
  }
});
test('search operators and colon-containing queries remain searches', () => {
  assert.deepEqual(inputIntent('site:developer.chrome.com split view'), { kind: 'search', text: 'site:developer.chrome.com split view' });
  assert.deepEqual(inputIntent('weather: Shanghai'), { kind: 'search', text: 'weather: Shanghai' });
});
test('palette matches tabs and resources while command mode excludes navigation', () => {
  const state = createState();
  state.workspaces[0].resources.push({ id: 'r1', title: 'Chrome guide', url: 'https://guide.test/', folder: 'Docs' });
  const data = { state, tabs: [{ id: 7, title: 'Chrome API', url: 'https://developer.chrome.com/' }] };
  const matches = paletteItems(data, 'chrome', 'home');
  assert.deepEqual(matches.filter(item => ['tab', 'resource'].includes(item.kind)).map(item => item.action), [
    { type: 'TAB_FOCUS', tabId: 7 }, { type: 'RESOURCE_OPEN', workspaceId: 'home', resourceId: 'r1' },
  ]);
  const commands = paletteItems(data, '> new tab', 'home');
  assert.equal(commands.length, 1);
  assert.equal(commands[0].action.type, 'NEW_TAB');
  assert.equal(paletteItems(data, '> no such command', 'home').length, 0);
});
test('workspace entries preserve their exact workspace identity', () => {
  const state = createState();
  state.workspaces.push({ id: 'research', name: 'Research', color: 'blue', resources: [], snapshot: null });
  const match = paletteItems({ state, tabs: [] }, 'research', 'home').find(item => item.kind === 'workspace');
  assert.deepEqual(match.action, { type: 'WORKSPACE_SWITCH', workspaceId: 'research' });
});
test('a protected URL can still select an existing tab without offering navigation', () => {
  const data = { state: createState(), tabs: [{ id: 7, title: 'Extensions', url: 'chrome://extensions/' }] };
  const matches = paletteItems(data, 'chrome://extensions/', 'home');
  assert.deepEqual(matches.map(item => item.action), [{ type: 'TAB_FOCUS', tabId: 7 }]);
});
test('concurrent palette requests share one popup for the same parent window', async () => {
  const created = [];
  const api = {
    runtime: { getURL: path => `chrome-extension://ama/${path}` },
    windows: {
      async get() { return { left: 0, top: 0, width: 1000, height: 800 }; },
      async getAll() { return [...created]; },
      async create(options) { const window = { id: created.length + 10, ...options }; created.push(window); return window; },
    },
  };
  const results = await Promise.all([openPalette(api, 1), openPalette(api, 1)]);
  assert.equal(created.length, 1);
  assert.equal(results[0].id, results[1].id);
});

test('palette opens centered over the originating window and reuses its existing popup', async () => {
  const windows = [];
  const focused = [];
  const api = {
    runtime: { getURL: path => `chrome-extension://ama/${path}`, async sendMessage() {} },
    windows: {
      async get(id) { assert.equal(id, 9); return { id, type: 'normal', left: -1200, top: 100, width: 1200, height: 900 }; },
      async getAll() { return windows; },
      async create(options) { const window = { ...options, id: 10, tabs: [{ url: options.url }] }; windows.push(window); return window; },
      async update(id, options) { focused.push({ id, ...options }); return windows[0]; },
    },
  };
  await openPalette(api, 9);
  assert.equal(windows.length, 1);
  assert.equal(new URL(windows[0].url).searchParams.get('windowId'), '9');
  assert.equal(windows[0].type, 'popup');
  assert.equal(windows[0].left, -940);
  assert.equal(windows[0].width, 680);
  await openPalette(api, 9);
  assert.equal(windows.length, 1);
  assert.deepEqual(focused, [{ id: 10, focused: true }]);
});
