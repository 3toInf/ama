import { paletteItems } from './palette-model.js';

const input = document.querySelector('#palette-input');
const list = document.querySelector('#palette-list');
const error = document.querySelector('#palette-error');
const closeButton = document.querySelector('#palette-close');
const windowParameter = new URLSearchParams(location.search).get('windowId');
const parentWindowId = windowParameter && /^\d+$/u.test(windowParameter) ? Number(windowParameter) : null;
let ownWindowId;
let data;
let workspaceId;
let items = [];
let selected = 0;
let busy = false;

function showError(value) { error.textContent = value.message || String(value); error.hidden = false; }
async function request(action) {
  const response = await chrome.runtime.sendMessage({ ...action, windowId: parentWindowId });
  if (!response?.ok) throw new Error(response?.error || '无法连接 AMA，请重新加载扩展。');
  return response.data;
}
async function close() { if (ownWindowId !== undefined) await chrome.windows.remove(ownWindowId); }
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
    const icon = document.createElement('span');
    icon.className = 'palette-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = { tab: '▣', resource: '☆', workspace: '◉', command: '⌘', archive: '↶', navigate: '↗' }[item.kind];
    const copy = document.createElement('span');
    copy.className = 'palette-copy';
    const title = document.createElement('strong');
    title.textContent = item.title;
    const detail = document.createElement('small');
    detail.textContent = item.detail;
    copy.append(title, detail);
    const enter = document.createElement('span');
    enter.className = 'palette-enter';
    enter.textContent = '↵';
    option.append(icon, copy, enter);
    option.addEventListener('mouseenter', () => select(index));
    option.addEventListener('click', () => execute(item));
    list.append(option);
  });
  document.querySelector('#palette-empty').hidden = items.length > 0 || !error.hidden;
  document.querySelector('#palette-count').textContent = `${items.length} 项`;
  select(0);
}
async function execute(item) {
  if (busy || !item) return;
  busy = true;
  input.disabled = closeButton.disabled = true;
  error.hidden = true;
  try {
    await request(item.action);
    await chrome.windows.update(parentWindowId, { focused: true });
    await close();
  } catch (failure) { showError(failure); }
  finally { busy = false; input.disabled = closeButton.disabled = false; input.focus(); }
}
async function load(reset = false) {
  if (parentWindowId === null) throw new Error('请使用快捷键或 AMA 侧栏打开命令面板。');
  data = await request({ type: 'READ' });
  workspaceId = data.session.active.find(item => item.windowId === parentWindowId)?.workspaceId ?? data.state.workspaces[0].id;
  if (!data.state.workspaces.some(item => item.id === workspaceId)) workspaceId = data.state.workspaces[0].id;
  document.querySelector('#palette-workspace').textContent = data.state.workspaces.find(item => item.id === workspaceId).name;
  if (reset) input.value = '';
  render();
  input.focus();
}
input.addEventListener('input', render);
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
  if (message.type === 'RESET_PALETTE' && message.paletteWindowId === ownWindowId && !busy) load(true).catch(showError);
});
(async () => {
  ownWindowId = (await chrome.windows.getCurrent()).id;
  await load();
})().catch(showError);
