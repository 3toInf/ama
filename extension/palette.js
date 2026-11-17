import { paletteItems } from './palette-model.js';
import { icon as uiIcon, siteIcon, hydrateIcons } from './icons.js';

const input = document.querySelector('#palette-input');
const list = document.querySelector('#palette-list');
const error = document.querySelector('#palette-error');
const closeButton = document.querySelector('#palette-close');
const parameters = new URLSearchParams(location.search);
const windowParameter = parameters.get('windowId');
const embedded = window.top !== window;
const overlayToken = parameters.get('overlayToken');
const popupToken = parameters.get('popupToken');
document.documentElement.dataset.host = embedded ? 'overlay' : 'popup';
const parentWindowId = windowParameter && /^\d+$/u.test(windowParameter) ? Number(windowParameter) : null;
let ownWindowId;
let data;
let workspaceId;
let items = [];
let selected = 0;
let busy = false;
let lastOverlayHeight;
let resizeFrame;

function resizeOverlay() {
  if (!embedded || !data) return;
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    // Measure intrinsic list content so a short query can expand again when cleared.
    const height = Math.ceil(document.querySelector('.query').offsetHeight + document.querySelector('footer').offsetHeight
      + 16 + Math.min(list.scrollHeight, 352) + (error.hidden ? 0 : error.offsetHeight + 14)
      + (document.querySelector('#palette-empty').hidden ? 0 : document.querySelector('#palette-empty').offsetHeight));
    if (height !== lastOverlayHeight) {
      lastOverlayHeight = height;
      request({ type: 'PALETTE_RESIZE', height }).catch(() => {});
    }
  });
}
function showError(value) { error.textContent = value.message || String(value); error.hidden = false; resizeOverlay(); }
async function request(action) {
  const response = await chrome.runtime.sendMessage({ ...action, windowId: parentWindowId,
    ...(embedded ? { overlayToken } : { popupToken, paletteWindowId: ownWindowId }) });
  if (!response?.ok) throw new Error(response?.error || '无法连接 AMA，请重新加载扩展。');
  return response.data;
}
async function close(restoreFocus = true) {
  await request({ type: 'PALETTE_CLOSE', restoreFocus });
}
function resultDetail(item) {
  if (item.pageUrl) {
    try {
      const url = new URL(item.pageUrl);
      if (url.protocol === 'chrome-extension:') return '扩展页面';
      if (url.protocol === 'chrome:') return `chrome://${url.hostname}`;
      return url.hostname.replace(/^www\./u, '') || (item.detail === item.title ? '' : item.detail);
    } catch { /* Use the text description. */ }
  }
  return item.kind === 'workspace' ? '工作区' : item.kind === 'command' ? '' : item.detail;
}
function select(index) {
  selected = Math.max(0, Math.min(index, items.length - 1));
  [...list.children].forEach((node, i) => node.setAttribute('aria-selected', String(i === selected)));
  if (items.length) {
    input.setAttribute('aria-activedescendant', `palette-option-${selected}`);
    list.children[selected]?.scrollIntoView({ block: 'nearest' });
  } else input.removeAttribute('aria-activedescendant');
}
function render() {
  if (!data) return;
  error.hidden = true;
  try { items = paletteItems(data, input.value, workspaceId); }
  catch (failure) { items = []; showError(failure); }
  list.replaceChildren();
  items.forEach((item, index) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'palette-option';
    option.id = `palette-option-${index}`;
    option.setAttribute('role', 'option');
    option.title = `${item.title}\n${item.detail}`;
    const icon = document.createElement('span');
    icon.className = 'palette-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.append(item.pageUrl ? siteIcon(item.pageUrl) : uiIcon({ workspace: 'panel', command: 'command', navigate: 'search' }[item.kind] || 'globe'));
    const copy = document.createElement('span');
    copy.className = 'palette-copy';
    const title = document.createElement('strong');
    title.textContent = item.title;
    const detail = document.createElement('small');
    detail.textContent = resultDetail(item);
    copy.append(title, detail);
    const enter = document.createElement('span');
    enter.className = 'palette-enter';
    enter.setAttribute('aria-hidden', 'true');
    const actionLabel = document.createElement('span');
    actionLabel.textContent = { tab: '切换标签', resource: '打开链接', workspace: '切换工作区', archive: '恢复网页', command: '执行命令', navigate: '打开' }[item.kind];
    const key = document.createElement('kbd');
    key.textContent = '↵';
    enter.append(actionLabel, key);
    option.append(icon, copy, enter);
    option.addEventListener('mouseenter', () => select(index));
    option.addEventListener('click', () => execute(item));
    list.append(option);
  });
  document.querySelector('#palette-empty').hidden = items.length > 0 || !error.hidden;
  document.querySelector('#palette-count').textContent = `${items.length} 项`;
  select(0);
  resizeOverlay();
}
async function execute(item) {
  if (busy || !item) return;
  busy = true;
  input.disabled = closeButton.disabled = true;
  error.hidden = true;
  try {
    await request(item.action);
    await chrome.windows.update(parentWindowId, { focused: true });
    await close(false);
  } catch (failure) { showError(failure); }
  finally { busy = false; input.disabled = closeButton.disabled = false; input.focus(); }
}
async function load(reset = false) {
  if (embedded && !overlayToken) throw new Error('请使用 AMA 快捷键打开命令面板。');
  if (!embedded && !popupToken) throw new Error('请使用 AMA 快捷键打开命令面板。');
  if (parentWindowId === null) throw new Error('请使用快捷键或 AMA 侧栏打开命令面板。');
  data = await request({ type: 'READ' });
  workspaceId = data.session.active.find(item => item.windowId === parentWindowId)?.workspaceId ?? data.state.workspaces[0].id;
  if (!data.state.workspaces.some(item => item.id === workspaceId)) workspaceId = data.state.workspaces[0].id;
  document.querySelector('#palette-workspace').textContent = data.state.workspaces.find(item => item.id === workspaceId).name;
  document.documentElement.dataset.spaceColor = data.state.workspaces.find(item => item.id === workspaceId).color;
  if (reset) input.value = '';
  render();
  input.focus();
}
input.addEventListener('input', render);
hydrateIcons();
input.addEventListener('keydown', event => {
  if (busy || event.isComposing || event.keyCode === 229) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); select(selected + (event.key === 'ArrowDown' ? 1 : -1));
  } else if (event.key === 'Enter') { event.preventDefault(); execute(items[selected]); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !event.isComposing && !busy) { event.preventDefault(); close().catch(showError); }
});
closeButton.addEventListener('click', () => { if (!busy) close().catch(showError); });
chrome.runtime.onMessage.addListener(message => {
  if (!embedded && message.type === 'RESET_PALETTE' && message.paletteWindowId === ownWindowId && !busy) load(true).catch(showError);
});
(async () => {
  if (!embedded) ownWindowId = (await chrome.windows.getCurrent()).id;
  await load();
  if (embedded) {
    await request({ type: 'PALETTE_READY' });
    new ResizeObserver(resizeOverlay).observe(document.querySelector('#palette-surface'));
    resizeOverlay();
  }
})().catch(showError);
