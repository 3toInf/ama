import { fakeChrome } from './helpers/fake-chrome.mjs';
import { createController } from '../extension/controller.js';
import { createState } from '../extension/core.js';
import { event } from './helpers/event.mjs';

const env = fakeChrome([
  { id: 1, windowId: 1, groupId: -1, active: true, pinned: false, audible: false, incognito: false,
    status: 'complete', title: 'Chrome extension documentation', url: 'https://developer.chrome.com/docs/extensions/', lastAccessed: Date.now() },
  { id: 2, windowId: 1, groupId: -1, active: false, pinned: false, audible: false, incognito: false,
    status: 'complete', title: 'Design notes', url: 'https://example.com/design', lastAccessed: Date.now() - 86400000 },
]);
env.local.ama = createState();
env.local.ama.workspaces[0].resources.push({ id: 'xss', title: '<img src=x onerror="window.pwned=true">', url: 'https://example.com/', folder: '参考资料' });
const storageChanged = event();
for (const name of ['local', 'session']) {
  const area = env.api.storage[name];
  const originalSet = area.set;
  area.set = async values => {
    const changes = {};
    for (const [key, value] of Object.entries(values)) {
      const oldValue = (await area.get(key))[key];
      if (JSON.stringify(oldValue) !== JSON.stringify(value)) changes[key] = { oldValue, newValue: structuredClone(value) };
    }
    await originalSet(values);
    if (Object.keys(changes).length) storageChanged.emit(changes, name);
  };
}
const controller = createController(env.api);
const paletteMode = new URLSearchParams(location.search).get('test') === 'palette';
globalThis.chrome = {
  ...env.api,
  runtime: { id: 'ama-test', getURL: path => new URL(`../extension${path}`, import.meta.url).href, async sendMessage(message) {
    try { return { ok: true, data: await controller.dispatch(message) }; }
    catch (error) { return { ok: false, error: error.message }; }
  }, onMessage: event() },
  windows: { ...env.api.windows, async getCurrent() { return { id: paletteMode ? 50 : 1 }; },
    async remove(id) { globalThis.__closedWindow = id; } },
  storage: { ...env.api.storage, onChanged: storageChanged },
  tabs: { ...env.api.tabs, onCreated: event(), onUpdated: event(), onRemoved: event(), onActivated: event(), onMoved: event() },
  tabGroups: { ...env.api.tabGroups, onUpdated: event(), onRemoved: event() },
};
globalThis.__ama = env;
// Reproduce a shortcut message arriving before the panel registers its listener.
chrome.runtime.onMessage.emit({ type: 'FOCUS_SEARCH', windowId: 1 });
await import(paletteMode ? '../extension/palette.js' : '../extension/panel.js');
