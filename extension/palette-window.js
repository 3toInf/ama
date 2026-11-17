import { tryOpenPaletteOverlay } from './palette-overlay.js';

const pendingByApi = new WeakMap();
const creatingPopups = new Map();
const popupKey = id => `amaPalettePopup:${id}`;

export function openPalette(api, parentWindowId) {
  let pending = pendingByApi.get(api);
  if (!pending) { pending = new Map(); pendingByApi.set(api, pending); }
  if (!pending.has(parentWindowId)) {
    const opening = createPalette(api, parentWindowId).finally(() => pending.delete(parentWindowId));
    pending.set(parentWindowId, opening);
  }
  return pending.get(parentWindowId);
}

async function createPalette(api, parentWindowId) {
  if (!Number.isInteger(parentWindowId) || parentWindowId < 0) throw new Error('无法确定命令面板所属窗口。');
  const parent = await api.windows.get(parentWindowId);
  if (parent.incognito) throw new Error('命令面板不支持隐身窗口。');
  const overlay = await tryOpenPaletteOverlay(api, parentWindowId);
  if (overlay) return overlay;
  const base = api.runtime.getURL('palette.html');
  for (const existing of await api.windows.getAll({ populate: true, windowTypes: ['popup'] })) {
    const lease = (await api.storage.session.get(popupKey(existing.id)))[popupKey(existing.id)];
    if (!lease || lease.parentWindowId !== parentWindowId || !existing.tabs?.some(tab => tab.url === lease.url)) continue;
    await api.windows.update(existing.id, { focused: true });
    await api.runtime.sendMessage({ type: 'RESET_PALETTE', paletteWindowId: existing.id }).catch(() => {});
    return existing;
  }
  const token = crypto.randomUUID();
  const url = `${base}?windowId=${parentWindowId}&popupToken=${token}`;
  const width = Math.max(320, Math.min(680, (parent.width ?? 1000) - 64));
  const height = Math.max(320, Math.min(520, (parent.height ?? 800) - 64));
  const creating = api.windows.create({ url, type: 'popup', focused: true, width, height,
    left: Math.round((parent.left ?? 0) + ((parent.width ?? 1000) - width) / 2),
    top: Math.round((parent.top ?? 0) + Math.max(0, ((parent.height ?? 800) - height) / 3)) }).then(async popup => {
    await api.storage.session.set({ [popupKey(popup.id)]: { token, parentWindowId, windowId: popup.id, tabId: popup.tabs?.[0]?.id, url } });
    return popup;
  });
  creatingPopups.set(token, creating);
  try { return await creating; } finally { creatingPopups.delete(token); }
}

export async function dispatchPopupMessage(api, message, sender, dispatch) {
  await creatingPopups.get(message.popupToken);
  const key = popupKey(message.paletteWindowId);
  const lease = (await api.storage.session.get(key))[key];
  if (sender.id !== api.runtime.id || (sender.frameId ?? 0) !== 0 || !sender.documentId || !lease
    || lease.token !== message.popupToken || sender.url !== lease.url || message.windowId !== lease.parentWindowId
    || (sender.tab && (sender.tab.windowId !== lease.windowId || (lease.tabId && sender.tab.id !== lease.tabId)))) throw new Error('请使用 AMA 快捷键打开命令面板。');
  const own = await api.windows.get(lease.windowId);
  if (own.type !== 'popup') throw new Error('此页面不是 AMA 创建的命令窗口。');
  if (message.type === 'PALETTE_CLOSE') {
    await api.windows.remove(lease.windowId);
    await api.storage.session.remove(key);
    return {};
  }
  return dispatch({ ...message, windowId: lease.parentWindowId });
}
