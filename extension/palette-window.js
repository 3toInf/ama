const pendingByApi = new WeakMap();

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
  const url = `${api.runtime.getURL('palette.html')}?windowId=${parentWindowId}`;
  const existing = (await api.windows.getAll({ populate: true, windowTypes: ['popup'] }))
    .find(window => window.tabs?.some(tab => tab.url === url));
  if (existing) {
    await api.windows.update(existing.id, { focused: true });
    await api.runtime.sendMessage({ type: 'RESET_PALETTE', paletteWindowId: existing.id }).catch(() => {});
    return existing;
  }
  const width = Math.max(320, Math.min(680, (parent.width ?? 1000) - 64));
  const height = Math.max(320, Math.min(520, (parent.height ?? 800) - 64));
  return api.windows.create({ url, type: 'popup', focused: true, width, height,
    left: Math.round((parent.left ?? 0) + ((parent.width ?? 1000) - width) / 2),
    top: Math.round((parent.top ?? 0) + Math.max(0, ((parent.height ?? 800) - height) / 3)) });
}
