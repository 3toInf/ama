import { fakeChrome } from './helpers/fake-chrome.mjs';
import { createController } from '../extension/controller.js';
import { createState } from '../extension/core.js';

const env = fakeChrome([
  { id: 1, windowId: 1, groupId: -1, active: true, pinned: false, audible: false, incognito: false,
    status: 'complete', title: 'Chrome extension documentation', url: 'https://developer.chrome.com/docs/extensions/', lastAccessed: Date.now() },
  { id: 2, windowId: 1, groupId: -1, active: false, pinned: false, audible: false, incognito: false,
    status: 'complete', title: 'Design notes', url: 'https://example.com/design', lastAccessed: Date.now() - 86400000 },
]);
env.local.ama = createState();
env.local.ama.workspaces[0].resources.push({ id: 'xss', title: '<img src=x onerror="window.pwned=true">', url: 'https://example.com/', folder: '参考资料' });
const controller = createController(env.api);
const event = () => ({ addListener() {} });
globalThis.chrome = {
  ...env.api,
  runtime: { id: 'ama-test', async sendMessage(message) {
    try { return { ok: true, data: await controller.dispatch(message) }; }
    catch (error) { return { ok: false, error: error.message }; }
  }, onMessage: event() },
  windows: { ...env.api.windows, async getCurrent() { return { id: 1 }; } },
  storage: { ...env.api.storage, onChanged: event() },
  tabs: { ...env.api.tabs, onCreated: event(), onUpdated: event(), onRemoved: event(), onActivated: event(), onMoved: event() },
  tabGroups: { ...env.api.tabGroups, onUpdated: event(), onRemoved: event() },
};
globalThis.__ama = env;
await import('../extension/panel.js');
