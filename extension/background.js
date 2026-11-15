import { createController } from './controller.js';

const controller = createController(chrome);
let menuQueue = Promise.resolve();

async function setError(error) {
  console.error('AMA:', error);
  await chrome.storage.session.set({ amaError: String(error.message || error).slice(0, 300) });
}

async function menus() {
  const { state } = await controller.dispatch({ type: 'READ', windowId: (await chrome.windows.getLastFocused()).id });
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'ama-peek', title: '在轻量窗口中打开', contexts: ['link'] });
  chrome.contextMenus.create({ id: 'ama-save', title: '保存到 AMA 工作区', contexts: ['link', 'page'] });
  for (const workspace of state.workspaces) {
    chrome.contextMenus.create({ id: `save:${workspace.id}`, parentId: 'ama-save', title: workspace.name, contexts: ['link', 'page'] });
  }
}

function scheduleMenus() {
  menuQueue = menuQueue.then(menus).catch(setError);
}

async function setup() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  if (!await chrome.alarms.get('ama-archive')) await chrome.alarms.create('ama-archive', { periodInMinutes: 5 });
  scheduleMenus();
}

chrome.runtime.onInstalled.addListener(() => { setup().catch(setError); });
chrome.runtime.onStartup.addListener(() => {
  controller.resetSession().then(setup).catch(setError);
});
// Alarms may be cleared across browser restarts, so recheck whenever the worker starts.
chrome.alarms.get('ama-archive').then(alarm => {
  if (!alarm) return chrome.alarms.create('ama-archive', { periodInMinutes: 5 });
}).catch(setError);

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  controller.dispatch(message).then(data => {
    respond({ ok: true, data });
    if (['WORKSPACE_CREATE', 'WORKSPACE_RENAME', 'WORKSPACE_DELETE', 'IMPORT'].includes(message.type)) scheduleMenus();
  }).catch(error => respond({ ok: false, error: error.message }));
  return true;
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-workspace' && tab?.windowId !== undefined) {
    // Keep this in the user-gesture call stack; awaiting other work would lose permission to open.
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(setError);
    chrome.runtime.sendMessage({ type: 'FOCUS_SEARCH' }).catch(() => {});
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const request = info.menuItemId === 'ama-peek'
    ? { type: 'PEEK', url: info.linkUrl }
    : { type: 'RESOURCE_ADD', workspaceId: String(info.menuItemId).slice(5),
      url: info.linkUrl || info.pageUrl, title: info.linkUrl || tab?.title || info.pageUrl, folder: '' };
  if (info.menuItemId === 'ama-peek' || String(info.menuItemId).startsWith('save:')) {
    controller.dispatch(request).catch(setError);
  }
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'ama-archive') controller.sweep().then(result => {
    if (result.errors.length) return setError(new Error(result.errors[0]));
  }).catch(setError);
});
chrome.tabs.onUpdated.addListener((id, change) => {
  if (change.url || change.status === 'complete') controller.route(id).catch(setError);
});
