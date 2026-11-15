export const supportsSplit = api => typeof api.tabs.createSplit === 'function' && typeof api.tabs.unsplit === 'function';
export const isSplit = tab => Number.isInteger(tab.splitViewId) && tab.splitViewId >= 0;

function requireSupport(api) {
  if (!supportsSplit(api)) throw new Error('分屏需要 Chrome 155 或更新版本，并启用原生分屏功能。');
}

export async function splitTabs(api, sourceId, targetId, windowId) {
  requireSupport(api);
  if (!Number.isInteger(sourceId) || !Number.isInteger(targetId) || sourceId === targetId) throw new Error('请选择两个不同的标签。');
  const [source, target] = await Promise.all([api.tabs.get(sourceId), api.tabs.get(targetId)]);
  if (source.incognito || target.incognito) throw new Error('不支持隐身标签分屏。');
  if (source.pinned || target.pinned) throw new Error('请先取消固定，再拖放分屏。');
  if (source.windowId !== windowId || target.windowId !== windowId) throw new Error('只能对同一窗口内的标签分屏。');
  if (source.groupId !== target.groupId) throw new Error('请先将两个标签放到同一工作区或同一标签组。');
  if (isSplit(source) && source.splitViewId === target.splitViewId) return { splitViewId: source.splitViewId };
  if (isSplit(source) || isSplit(target)) throw new Error('请先取消已有分屏，再配对其他标签。');
  if (source.index !== target.index + 1) {
    await api.tabs.move(sourceId, { index: target.index + (source.index > target.index ? 1 : 0) });
  }
  const splitViewId = await api.tabs.createSplit([targetId, sourceId]);
  await api.tabs.update(sourceId, { active: true });
  return { splitViewId };
}

export async function unsplitTab(api, tabId, windowId) {
  requireSupport(api);
  const tab = await api.tabs.get(tabId);
  if (tab.windowId !== windowId || tab.incognito) throw new Error('只能操作当前窗口中的普通标签。');
  if (isSplit(tab)) await api.tabs.unsplit(tab.splitViewId);
  return {};
}
