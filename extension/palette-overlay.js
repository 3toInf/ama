const queues = new WeakMap();
const sessionKey = tabId => `amaPalette:${tabId}`;
const actions = new Set(['READ', 'TAB_FOCUS', 'RESOURCE_OPEN', 'WORKSPACE_SWITCH', 'ARCHIVE_RESTORE', 'NEW_TAB', 'SAVE_CURRENT', 'OPEN_SETTINGS', 'OPEN_INPUT']);

function sessionTask(api, tabId, task) {
  if (!queues.has(api)) queues.set(api, new Map());
  const pending = queues.get(api);
  const operation = (pending.get(tabId) || Promise.resolve()).catch(() => {}).then(task);
  pending.set(tabId, operation);
  operation.finally(() => { if (pending.get(tabId) === operation) pending.delete(tabId); }).catch(() => {});
  return operation;
}
async function clearSession(api, tabId, token) {
  return sessionTask(api, tabId, async () => {
    const key = sessionKey(tabId);
    if ((await api.storage.session.get(key))[key]?.token === token) await api.storage.session.remove(key);
  });
}

export async function tryOpenPaletteOverlay(api, windowId) {
  if (!api.scripting?.executeScript || !api.tabs?.query) return null;
  const [tab] = await api.tabs.query({ windowId, active: true });
  if (!tab || tab.incognito || !/^https?:\/\//u.test(tab.url || '')) return null;
  const token = crypto.randomUUID();
  const url = new URL(api.runtime.getURL('palette.html'));
  url.searchParams.set('windowId', windowId);
  url.searchParams.set('overlayToken', token);
  await sessionTask(api, tab.id, () => api.storage.session.set({ [sessionKey(tab.id)]: { token, tabId: tab.id, windowId } }));
  try {
    const result = await api.scripting.executeScript({ target: { tabId: tab.id }, func: mountPalette, args: [url.href, token] });
    if (result[0]?.result === true) return { mode: 'overlay', tabId: tab.id, windowId };
    if (result[0]?.result === 'cancelled') { await clearSession(api, tab.id, token); return { mode: 'dismissed' }; }
  } catch { /* No activeTab grant, protected site, or navigation: retain the popup route. */ }
  await clearSession(api, tab.id, token);
  return null;
}

export async function dismissOverlaySession(api, message, sender) {
  if (sender.id !== api.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)) return;
  await clearSession(api, sender.tab.id, message.overlayToken);
}

export async function dispatchOverlayMessage(api, message, sender, dispatch) {
  const tabId = sender.tab?.id;
  if (sender.id !== api.runtime.id || !Number.isInteger(tabId) || !(sender.frameId > 0) || !sender.documentId) throw new Error('无效的命令面板来源。');
  const lease = await sessionTask(api, tabId, async () => {
    const key = sessionKey(tabId);
    const current = (await api.storage.session.get(key))[key];
    const url = new URL(sender.url);
    const expected = new URL(api.runtime.getURL('palette.html'));
    if (!current || current.token !== message.overlayToken || current.windowId !== sender.tab.windowId
      || message.windowId !== current.windowId || url.protocol !== expected.protocol || url.host !== expected.host || url.pathname !== expected.pathname
      || url.searchParams.get('overlayToken') !== current.token || (current.documentId && current.documentId !== sender.documentId)) {
      throw new Error('命令面板已失效，请用快捷键重新打开。');
    }
    if (!current.documentId) {
      current.documentId = sender.documentId;
      await api.storage.session.set({ [key]: current });
    }
    return current;
  });
  const send = payload => api.tabs.sendMessage(tabId, { ...payload, token: lease.token }, { frameId: 0 });
  if (message.type === 'PALETTE_READY') {
    await send({ type: 'AMA_PALETTE_READY' });
    return {};
  }
  if (message.type === 'PALETTE_RESIZE') {
    if (!Number.isFinite(message.height)) throw new Error('无效的面板尺寸。');
    await send({ type: 'AMA_PALETTE_RESIZE', height: Math.max(140, Math.min(560, Math.ceil(message.height))) });
    return {};
  }
  if (message.type === 'PALETTE_CLOSE') {
    await send({ type: 'AMA_PALETTE_REMOVE', restoreFocus: message.restoreFocus !== false }).catch(() => {});
    await clearSession(api, tabId, lease.token);
    return {};
  }
  if (!actions.has(message.type)) throw new Error('命令面板不支持此操作。');
  return dispatch({ ...message, windowId: lease.windowId });
}

// Serialized by chrome.scripting; keep this function self-contained in the isolated world.
function mountPalette(url, token) {
  return new Promise(resolve => {
    const previousFocus = globalThis.__amaPaletteOverlay?.previousFocus || document.activeElement;
    globalThis.__amaPaletteOverlay?.dispose(false);
    const host = document.createElement('div');
    host.style.cssText = 'all:initial!important;display:block!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      dialog { position:fixed; inset:0; width:100vw; height:100dvh; max-width:none; max-height:none; margin:0; padding:0; border:0; outline:0; background:rgb(28 25 42 / .18); backdrop-filter:blur(5px); display:flex; align-items:flex-start; justify-content:center; pointer-events:auto; overflow:hidden; }
      dialog::backdrop { background:transparent; }
      iframe { display:block; width:min(640px, calc(100vw - 32px)); height:480px; max-height:calc(100dvh - clamp(16px, 16vh, 140px) - 16px); margin-top:clamp(16px, 16vh, 140px); border:0; outline:0; border-radius:16px; background:transparent; box-shadow:0 24px 90px #17122645, 0 6px 24px #17122624; animation:ama-enter .14s ease-out; }
      @keyframes ama-enter { from { opacity:0; transform:translateY(-6px) scale(.99); } to { opacity:1; transform:none; } }
      @media (prefers-reduced-motion:reduce) { iframe { animation:none; } }
    `;
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'AMA 命令面板');
    const frame = document.createElement('iframe');
    frame.src = url;
    frame.title = 'AMA 命令面板';
    frame.referrerPolicy = 'no-referrer';
    dialog.append(frame);
    root.append(style, dialog);
    let settled = false;
    let disposed = false;
    const finish = result => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const dispose = (restoreFocus = true, outcome = 'cancelled') => {
      if (disposed) return;
      disposed = true;
      chrome.runtime.onMessage.removeListener(listener);
      window.removeEventListener('pagehide', onPageHide);
      host.remove();
      if (globalThis.__amaPaletteOverlay?.token === token) delete globalThis.__amaPaletteOverlay;
      finish(outcome);
      if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      chrome.runtime.sendMessage({ type: 'PALETTE_DISMISSED', overlayToken: token }).catch(() => {});
    };
    const listener = (message, sender, respond) => {
      if (sender.id !== chrome.runtime.id || message.token !== token) return;
      if (message.type === 'AMA_PALETTE_READY') finish(true);
      else if (message.type === 'AMA_PALETTE_RESIZE') frame.style.height = `${message.height}px`;
      else if (message.type === 'AMA_PALETTE_REMOVE') dispose(message.restoreFocus);
      else return;
      respond({ ok: true });
    };
    const onPageHide = () => dispose(false);
    const timer = setTimeout(() => dispose(false, false), 4000);
    globalThis.__amaPaletteOverlay = { token, dispose, previousFocus };
    chrome.runtime.onMessage.addListener(listener);
    window.addEventListener('pagehide', onPageHide, { once: true });
    dialog.addEventListener('cancel', event => { event.preventDefault(); dispose(); });
    dialog.addEventListener('click', event => { if (event.target === dialog) dispose(); });
    try {
      document.documentElement.append(host);
      dialog.showModal();
      frame.focus();
    } catch { dispose(false, false); }
  });
}
