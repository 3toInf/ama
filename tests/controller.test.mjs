import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../extension/controller.js';
import { createState } from '../extension/core.js';
import { fakeChrome } from './helpers/fake-chrome.mjs';

const now = 1_800_000_000_000;
const page = { id: 1, windowId: 1, groupId: -1, url: 'https://example.com/', title: 'Example',
  active: false, pinned: false, audible: false, incognito: false, status: 'complete', lastAccessed: now - 13 * 3600000 };
function setup(tabs = [page]) {
  const fake = fakeChrome(tabs);
  const app = createController(fake.api, { now: () => now });
  return { ...fake, app };
}

test('palette opens a URL in the originating workspace and window', async () => {
  const env = setup();
  const tab = await env.app.dispatch({ type: 'OPEN_INPUT', input: 'example.org/docs', windowId: 9, workspaceId: 'home' });
  assert.equal(tab.windowId, 9);
  assert.equal(env.tabs.get(tab.id).url, 'https://example.org/docs');
  assert.ok(env.tabs.get(tab.id).groupId >= 0);
  assert.equal(env.control.focusedWindow, 9);
});
test('palette searches through the configured provider in an explicit target tab', async () => {
  const env = setup();
  const tab = await env.app.dispatch({ type: 'OPEN_INPUT', input: 'Chrome 分屏 API', windowId: 9, workspaceId: 'home' });
  assert.deepEqual(env.searches, [{ text: 'Chrome 分屏 API', tabId: tab.id }]);
  assert.equal(env.tabs.get(tab.id).windowId, 9);
  assert.equal(env.control.focusedWindow, 9);
  assert.equal(env.tabs.get(1).url, page.url);
});
test('unsafe palette navigation fails before creating or modifying tabs', async () => {
  const env = setup();
  await assert.rejects(env.app.dispatch({ type: 'OPEN_INPUT', input: 'javascript:alert(1)', windowId: 1, workspaceId: 'home' }), /http/);
  assert.equal(env.tabs.size, 1);
  assert.deepEqual(env.events, []);
});
test('palette new-tab and save-current commands use the parent browser window', async () => {
  const env = setup([{ ...page, active: true, windowId: 9 }]);
  await env.app.dispatch({ type: 'SAVE_CURRENT', windowId: 9, workspaceId: 'home' });
  assert.equal(env.local.ama.workspaces[0].resources[0].url, page.url);
  const tab = await env.app.dispatch({ type: 'NEW_TAB', windowId: 9, workspaceId: 'home' });
  assert.equal(tab.windowId, 9);
  assert.ok(env.tabs.get(tab.id).groupId >= 0);
  assert.equal(env.control.focusedWindow, 9);
});

test('archive is durable before a tab closes, and survives worker recreation', async () => {
  const env = setup();
  await env.app.dispatch({ type: 'TAB_ARCHIVE', tabId: 1 });
  assert.equal(env.tabs.has(1), false);
  assert.ok(env.events.indexOf('local:save') < env.events.indexOf('tab:remove'));
  const restarted = createController(env.api);
  const result = await restarted.dispatch({ type: 'READ', windowId: 1 });
  assert.equal(result.state.archive[0].url, 'https://example.com/');
});

test('failed storage cannot cause a page to be closed', async () => {
  const env = setup();
  env.control.failSave = true;
  await assert.rejects(env.app.dispatch({ type: 'TAB_ARCHIVE', tabId: 1 }), /Storage full/);
  assert.equal(env.tabs.has(1), true);
});

test('a tab activated after the archive write stays open', async () => {
  const env = setup();
  env.local.ama = createState();
  env.local.ama.settings.autoArchive = true;
  env.control.afterSave = () => { env.tabs.get(1).active = true; };
  await env.app.sweep();
  assert.equal(env.tabs.has(1), true);
});

test('failed restoration keeps the archive available for another attempt', async () => {
  const env = setup();
  await env.app.dispatch({ type: 'TAB_ARCHIVE', tabId: 1 });
  const id = env.local.ama.archive[0].id;
  env.control.failCreate = true;
  await assert.rejects(env.app.dispatch({ type: 'ARCHIVE_RESTORE', archiveId: id, windowId: 1 }));
  assert.equal(env.local.ama.archive[0].id, id);
});

test('concurrent resource saves preserve every distinct link', async () => {
  const env = setup();
  await Promise.all(Array.from({ length: 15 }, (_, i) => env.app.dispatch({
    type: 'RESOURCE_ADD', workspaceId: 'home', title: `Page ${i}`, url: `https://example.com/${i}`, folder: '',
  })));
  assert.equal(env.local.ama.workspaces[0].resources.length, 15);
});

test('workspaces group tabs in their own windows without closing existing pages', async () => {
  const env = setup([page, { ...page, id: 2, windowId: 2 }]);
  await env.app.dispatch({ type: 'TAB_MOVE', tabId: 1, workspaceId: 'home' });
  await env.app.dispatch({ type: 'TAB_MOVE', tabId: 2, workspaceId: 'home' });
  assert.notEqual(env.tabs.get(1).groupId, env.tabs.get(2).groupId);
  assert.equal(env.tabs.size, 2);
  assert.equal(env.events.includes('tab:remove'), false);
});

test('stale group references do not move a tab into an unrelated window group', async () => {
  const env = setup();
  env.groups.set(99, { id: 99, windowId: 2, title: 'Someone else', collapsed: false });
  env.session.amaSession = { groups: [{ workspaceId: 'home', windowId: 1, groupId: 99 }], active: [] };
  await env.app.dispatch({ type: 'TAB_MOVE', tabId: 1, workspaceId: 'home' });
  assert.notEqual(env.tabs.get(1).groupId, 99);
  assert.equal(env.groups.get(99).title, 'Someone else');
});

test('workspace switching collapses only managed groups and leaves tabs alive', async () => {
  const env = setup([page, { ...page, id: 2, url: 'https://other.test/' }]);
  const second = await env.app.dispatch({ type: 'WORKSPACE_CREATE', name: 'Research', color: 'blue' });
  await env.app.dispatch({ type: 'TAB_MOVE', tabId: 1, workspaceId: 'home' });
  await env.app.dispatch({ type: 'TAB_MOVE', tabId: 2, workspaceId: second.id });
  env.groups.set(90, { id: 90, windowId: 1, collapsed: false, title: 'Unmanaged' });
  await env.app.dispatch({ type: 'WORKSPACE_SWITCH', workspaceId: 'home', windowId: 1 });
  assert.equal(env.groups.get(env.tabs.get(1).groupId).collapsed, false);
  assert.equal(env.groups.get(env.tabs.get(2).groupId).collapsed, true);
  assert.equal(env.groups.get(90).collapsed, false);
  assert.equal(env.tabs.size, 2);
});

test('domain routes honor hostname boundaries and skip pinned or private pages', async () => {
  const env = setup([page, { ...page, id: 2, url: 'https://evilexample.com/' }, { ...page, id: 3, pinned: true }]);
  await env.app.dispatch({ type: 'RULE_SAVE', domain: 'example.com', workspaceId: 'home' });
  for (const id of [1, 2, 3]) await env.app.route(id);
  assert.notEqual(env.tabs.get(1).groupId, -1);
  assert.equal(env.tabs.get(2).groupId, -1);
  assert.equal(env.tabs.get(3).groupId, -1);
});

test('snapshot restoration does not duplicate a page already in that workspace', async () => {
  const env = setup();
  await env.app.dispatch({ type: 'TAB_MOVE', tabId: 1, workspaceId: 'home' });
  await env.app.dispatch({ type: 'SNAPSHOT_SAVE', workspaceId: 'home', windowId: 1 });
  await env.app.dispatch({ type: 'SNAPSHOT_RESTORE', workspaceId: 'home', windowId: 1 });
  assert.equal(env.tabs.size, 1);
});

test('a new browser session forgets only ephemeral bindings, not saved resources', async () => {
  const env = setup();
  await env.app.dispatch({ type: 'RESOURCE_ADD', workspaceId: 'home', title: 'Docs', url: 'https://example.com/' });
  await env.app.dispatch({ type: 'TAB_MOVE', tabId: 1, workspaceId: 'home' });
  await env.app.resetSession();
  const result = await env.app.dispatch({ type: 'READ', windowId: 1 });
  assert.equal(result.session.groups.length, 0);
  assert.equal(result.state.workspaces[0].resources.length, 1);
});

test('saved resources are excluded from automatic archive', async () => {
  const env = setup();
  await env.app.dispatch({ type: 'RESOURCE_ADD', workspaceId: 'home', title: 'Docs', url: page.url });
  await env.app.dispatch({ type: 'SETTINGS_SAVE', settings: { autoArchive: true, archiveHours: 12 } });
  await env.app.sweep();
  assert.equal(env.tabs.has(1), true);
});

test('deleting a workspace releases live tabs and retains archived URLs', async () => {
  const env = setup([page, { ...page, id: 2 }]);
  const workspace = await env.app.dispatch({ type: 'WORKSPACE_CREATE', name: 'Temporary', color: 'blue' });
  await env.app.dispatch({ type: 'TAB_MOVE', tabId: 1, workspaceId: workspace.id });
  await env.app.dispatch({ type: 'TAB_MOVE', tabId: 2, workspaceId: workspace.id });
  await env.app.dispatch({ type: 'TAB_ARCHIVE', tabId: 1 });
  await env.app.dispatch({ type: 'WORKSPACE_DELETE', workspaceId: workspace.id });
  assert.equal(env.tabs.get(2).groupId, -1);
  assert.equal(env.local.ama.archive[0].workspaceId, null);
});

test('local writes reject state that cannot fit in a portable backup, preserving previous data', async () => {
  const env = setup();
  await env.app.dispatch({ type: 'RESOURCE_ADD', workspaceId: 'home', title: 'Kept', url: 'https://kept.example/' });
  const prior = structuredClone(env.local.ama);
  const backup = { format: 'ama-backup', version: 1, data: createState() };
  backup.data.workspaces[0].resources = Array.from({ length: 1900 }, (_, i) => ({
    id: `${i}`, title: 't'.repeat(100), url: `https://example.com/${i}/${'a'.repeat(920)}`, folder: '',
  }));
  // This input fits; new generated IDs and union with existing state take the result over capacity.
  assert.ok(Buffer.byteLength(JSON.stringify(backup)) < 2 * 1024 * 1024);
  await assert.rejects(env.app.dispatch({ type: 'IMPORT', backup }), /2 MB/);
  assert.deepEqual(env.local.ama, prior);
});
