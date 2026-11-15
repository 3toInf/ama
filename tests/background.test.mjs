import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeChrome } from './helpers/fake-chrome.mjs';
import { event } from './helpers/event.mjs';

test('shortcut opens within the user gesture, then targets search in that window after opening', async t => {
  const previous = globalThis.chrome;
  const env = fakeChrome();
  const messages = [];
  const opened = [];
  const opening = Promise.withResolvers();
  t.after(() => { opening.resolve(); globalThis.chrome = previous; });
  globalThis.chrome = {
    ...env.api,
    runtime: { onInstalled: event(), onStartup: event(), onMessage: event(),
      async sendMessage(message) { messages.push(message); } },
    commands: { onCommand: event() },
    sidePanel: { open(options) { opened.push(options); return opening.promise; } },
    alarms: { async get() { return { name: 'ama-archive' }; }, onAlarm: event() },
    contextMenus: { onClicked: event() },
    tabs: { ...env.api.tabs, onUpdated: event() },
  };
  await import('../extension/background.js');
  chrome.commands.onCommand.emit('open-workspace', { id: 7, windowId: 42 });
  assert.deepEqual(opened, [{ windowId: 42 }], 'opening must start before yielding the gesture');
  assert.deepEqual(messages, [], 'do not send focus before the panel opens');
  opening.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(messages, [{ type: 'FOCUS_SEARCH', windowId: 42 }]);
});

test('repeated identical background failures produce separate notifications', async t => {
  const previous = globalThis.chrome;
  const env = fakeChrome();
  t.after(() => { globalThis.chrome = previous; });
  t.mock.method(console, 'error', () => {});
  globalThis.chrome = {
    ...env.api,
    runtime: { onInstalled: event(), onStartup: event(), onMessage: event() },
    commands: { onCommand: event() },
    sidePanel: { async open() { throw new Error('Cannot open panel'); } },
    alarms: { async get() { return { name: 'ama-archive' }; }, onAlarm: event() },
    contextMenus: { onClicked: event() },
    tabs: { ...env.api.tabs, onUpdated: event() },
  };
  await import('../extension/background.js?repeated-error');
  chrome.commands.onCommand.emit('open-workspace', { windowId: 1 });
  await new Promise(resolve => setImmediate(resolve));
  const first = structuredClone(env.session.amaError);
  chrome.commands.onCommand.emit('open-workspace', { windowId: 1 });
  await new Promise(resolve => setImmediate(resolve));
  assert.notDeepEqual(env.session.amaError, first, 'each occurrence must notify storage subscribers');
  assert.equal(first.message, 'Cannot open panel');
  assert.equal(env.session.amaError.message, 'Cannot open panel');
});
