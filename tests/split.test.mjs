import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../extension/controller.js';
import { createState, canArchive } from '../extension/core.js';
import { fakeChrome } from './helpers/fake-chrome.mjs';

const page = { windowId: 1, groupId: -1, active: false, pinned: false, incognito: false,
  audible: false, status: 'complete', url: 'https://example.com/', lastAccessed: 1000 };
const setup = () => {
  const env = fakeChrome([1, 2, 3].map(id => ({ ...page, id })));
  return { ...env, app: createController(env.api) };
};
const split = (env, sourceTabId = 3, targetTabId = 1) => env.app.dispatch({ type: 'TABS_SPLIT', sourceTabId, targetTabId, windowId: 1 });

for (const [source, target, order] of [[3, 1, [1, 3, 2]], [1, 3, [2, 3, 1]]]) {
  test(`split reorders ${source} beside ${target} without closing or replacing tabs`, async () => {
    const env = setup();
    await split(env, source, target);
    assert.deepEqual((await env.api.tabs.query({ windowId: 1 })).map(tab => tab.id), order);
    assert.ok(env.tabs.get(source).splitViewId >= 0);
    assert.equal(env.tabs.get(source).splitViewId, env.tabs.get(target).splitViewId);
    assert.equal(env.events.includes('tab:remove'), false);
    assert.equal(env.tabs.size, 3);
  });
}
test('splitting an existing pair is harmless, while adding a third page is refused', async () => {
  const env = setup();
  await split(env);
  const first = env.tabs.get(3).splitViewId;
  await split(env);
  assert.equal(env.tabs.get(3).splitViewId, first);
  await assert.rejects(split(env, 2, 1), /取消.*分屏/);
  assert.equal(env.tabs.get(2).splitViewId, -1);
});
test('unsplitting retains both pages and their group membership', async () => {
  const env = setup();
  await split(env);
  await env.app.dispatch({ type: 'TAB_UNSPLIT', tabId: 1, windowId: 1 });
  assert.equal(env.tabs.get(1).splitViewId, -1);
  assert.equal(env.tabs.get(3).splitViewId, -1);
  assert.equal(env.tabs.size, 3);
  assert.equal(env.tabs.get(1).groupId, -1);
});
for (const overrides of [{ windowId: 2 }, { groupId: 5 }, { pinned: true }, { incognito: true }]) {
  test(`ineligible split ${JSON.stringify(overrides)} fails before moving tabs`, async () => {
    const env = setup();
    Object.assign(env.tabs.get(3), overrides);
    await assert.rejects(split(env), /同一|固定|隐身/);
    assert.deepEqual(env.events, []);
  });
}
test('missing tabs and dropping a tab onto itself cannot mutate the browser', async () => {
  const env = setup();
  await assert.rejects(split(env, 999, 1), /No tab/);
  await assert.rejects(split(env, 1, 1), /两个不同/);
  assert.deepEqual(env.events, []);
});
test('unsupported split API is reported to UI and fails with a useful message', async () => {
  const env = setup();
  delete env.api.tabs.createSplit;
  const data = await env.app.dispatch({ type: 'READ', windowId: 1 });
  assert.equal(data.capabilities?.splitView, false);
  await assert.rejects(split(env), /Chrome 155/);
  assert.deepEqual(env.events, []);
});
test('automatic archive protects inactive split members that may still be visible', () => {
  const settings = { ...createState().settings, autoArchive: true, archiveHours: 1 };
  assert.equal(canArchive({ ...page, splitViewId: 7 }, settings, 10_000_000, true), false);
  assert.equal(canArchive({ ...page, splitViewId: 7 }, settings, 10_000_000, false), true);
});
