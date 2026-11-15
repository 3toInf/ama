import { searchItems, MAX_BACKUP_BYTES, COLORS } from './core.js';

const $ = selector => document.querySelector(selector);
const colors = { grey: '#99919f', blue: '#6a8bbc', red: '#c86b74', yellow: '#baa358', green: '#79a18a', pink: '#bd88a6', purple: '#9781b4', cyan: '#63a9b4', orange: '#c48d66' };
let data;
let targetWindow;
let currentWorkspace;
let view = new URLSearchParams(location.search).get('view') === 'settings' ? 'settings' : 'workspace';
let editingWorkspace = null;
let settingsDirty = false;
let refreshVersion = 0;
let refreshTimer;
let toastTimer;
const folderExpansion = new Map();
const isOptionsPage = new URLSearchParams(location.search).get('view') === 'settings';

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function notify(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 2800);
}

function showError(error) {
  $('#error').textContent = error.message || String(error);
  $('#error').hidden = false;
}

function showBackgroundError(value) {
  const message = typeof value === 'string' ? value : value?.message;
  if (message) showError(new Error(`后台操作未完成：${message}`));
}

async function request(type, payload = {}) {
  const result = await chrome.runtime.sendMessage({ type, windowId: targetWindow, ...payload });
  if (!result?.ok) throw new Error(result?.error || '无法连接 AMA，请在扩展管理中重新加载后再打开侧栏。');
  return result.data;
}

async function action(type, payload, message) {
  $('#error').hidden = true;
  const result = await request(type, payload);
  await refresh();
  if (message) notify(message);
  return result;
}

function run(task) { Promise.resolve().then(task).catch(showError); }

function button(label, title, handler, actionName) {
  const node = element('button', '', label);
  node.type = 'button';
  node.title = title;
  node.setAttribute('aria-label', title);
  if (actionName) node.dataset.action = actionName;
  node.addEventListener('click', () => run(async () => {
    node.disabled = true;
    try { await handler(); } finally { node.disabled = false; }
  }));
  return node;
}

function empty(target, title, subtitle = '') {
  const block = element('div', 'empty');
  block.append(element('strong', '', title), element('span', '', subtitle));
  target.append(block);
}

function hostname(url) {
  try { return new URL(url).hostname || url; } catch { return url || ''; }
}

function workspace() { return data.state.workspaces.find(item => item.id === currentWorkspace) ?? data.state.workspaces[0]; }
function workspaceName(id) { return data.state.workspaces.find(item => item.id === id)?.name || '未分组'; }

function row(item, kind, owner) {
  const node = element('div', `row${item.active ? ' active' : ''}`);
  const icon = element('span', 'page-icon', hostname(item.url).replace(/^www\./u, '').slice(0, 1).toUpperCase() || '↗');
  icon.setAttribute('aria-hidden', 'true');
  const content = button('', item.title || item.url, async () => {
    if (kind === 'resource') await action('RESOURCE_OPEN', { workspaceId: owner, resourceId: item.id });
    if (kind === 'tab' || kind === 'unassigned') await action('TAB_FOCUS', { tabId: item.id });
    if (kind === 'archive') await action('ARCHIVE_RESTORE', { archiveId: item.id }, '页面已恢复');
  });
  content.className = 'row-content';
  content.append(element('strong', '', item.title || item.url));
  const detail = [hostname(item.url), item.workspaceName];
  if (kind === 'archive') detail.push(new Date(item.archivedAt).toLocaleDateString());
  content.append(element('small', '', detail.filter(Boolean).join(' · ')));
  const actions = element('div', 'row-actions');
  if (kind === 'resource') {
    actions.append(button('↗', '在轻量窗口中打开', () => action('PEEK', { url: item.url })));
    actions.append(button('×', '移除常用链接', async () => {
      if (confirm(`移除常用链接“${item.title}”？已打开的页面会保留。`)) {
        await action('RESOURCE_REMOVE', { workspaceId: owner, resourceId: item.id }, '链接已移除');
      }
    }));
  } else if (kind === 'archive') {
    actions.append(button('↶', '恢复归档', () => action('ARCHIVE_RESTORE', { archiveId: item.id }, '页面已恢复')));
    actions.append(button('×', '删除归档记录', async () => {
      if (confirm(`永久移除“${item.title}”的这条归档记录？`)) await action('ARCHIVE_DELETE', { archiveId: item.id }, '记录已删除');
    }));
  } else {
    if (kind === 'unassigned' && !item.pinned) actions.append(button('＋', '收入当前工作区', () => action('TAB_MOVE', { tabId: item.id, workspaceId: currentWorkspace }, '已收入工作区'), 'move'));
    actions.append(button('☆', '保存为常用链接', () => openResourceDialog(item)));
    if (!item.pinned && !item.audible) actions.append(button('↓', '归档此标签，未保存输入不会保留', () => action('TAB_ARCHIVE', { tabId: item.id }, '已归档，可随时找回'), 'archive'));
  }
  node.append(icon, content, actions);
  return node;
}

function renderResources() {
  const target = $('#resources');
  // Capture the old DOM before replacing it, including a toggle followed by an immediate refresh.
  for (const folder of target.querySelectorAll('details[data-folder-key]')) {
    folderExpansion.set(folder.dataset.folderKey, folder.open);
  }
  target.replaceChildren();
  const resources = workspace().resources;
  $('#resource-count').textContent = resources.length;
  if (!resources.length) return empty(target, '把常用网站留在这里', '链接会一直保留，也不会被自动归档。');
  const folders = new Map();
  for (const resource of resources) {
    if (!resource.folder) target.append(row(resource, 'resource', currentWorkspace));
    else {
      if (!folders.has(resource.folder)) folders.set(resource.folder, []);
      folders.get(resource.folder).push(resource);
    }
  }
  for (const [name, entries] of folders) {
    const folder = element('details', 'folder');
    const key = JSON.stringify([workspace().id, name]);
    folder.dataset.folderKey = key;
    folder.open = folderExpansion.get(key) ?? true;
    folder.append(element('summary', '', `${name} · ${entries.length}`));
    entries.forEach(item => folder.append(row(item, 'resource', currentWorkspace)));
    target.append(folder);
  }
}

function renderWorkspaces() {
  const list = $('#workspaces');
  list.replaceChildren();
  for (const item of data.state.workspaces) {
    const chip = button('', `切换到 ${item.name}`, async () => {
      await action('WORKSPACE_SWITCH', { workspaceId: item.id });
      currentWorkspace = item.id;
      render();
    });
    chip.className = `workspace-chip${item.id === currentWorkspace ? ' selected' : ''}`;
    chip.setAttribute('aria-pressed', String(item.id === currentWorkspace));
    const dot = element('span', 'dot');
    dot.style.backgroundColor = colors[item.color] || colors.purple;
    chip.append(dot, element('span', '', item.name));
    list.append(chip);
  }
  const item = workspace();
  $('#workspace-title').textContent = item.name;
  const binding = data.session.groups.find(group => group.windowId === targetWindow && group.workspaceId === item.id);
  const tabs = binding ? data.tabs.filter(tab => tab.groupId === binding.groupId) : [];
  $('#workspace-subtitle').textContent = `${item.resources.length} 个常用链接 · ${tabs.length} 个打开的标签`;
  $('#tabs').replaceChildren(...tabs.map(tab => row(tab, 'tab')));
  $('#tab-count').textContent = tabs.length;
  if (!tabs.length) empty($('#tabs'), '这一刻，留点空白', '从下方收入标签，或打开一个常用链接。');
  const groups = new Set(data.session.groups.filter(group => group.windowId === targetWindow).map(group => group.groupId));
  const unassigned = data.tabs.filter(tab => !groups.has(tab.groupId));
  $('#unassigned').replaceChildren(...unassigned.map(tab => row(tab, 'unassigned')));
  if (!unassigned.length) empty($('#unassigned'), '都整理好了');
  $('#snapshot').replaceChildren();
  if (item.snapshot) {
    $('#snapshot').append(element('span', '', `${new Date(item.snapshot.savedAt).toLocaleDateString()} · ${item.snapshot.tabs.length} 个网页`));
    const restore = button('恢复快照', '打开快照中缺少的页面', () => action('SNAPSHOT_RESTORE', { workspaceId: currentWorkspace }, '快照中的页面已打开'));
    restore.className = 'text-button';
    $('#snapshot').append(restore);
  }
  renderResources();
}

function renderSettings() {
  if (!settingsDirty) {
    $('#auto-archive').checked = data.state.settings.autoArchive;
    const hours = String(data.state.settings.archiveHours);
    if (![...$('#archive-hours').options].some(option => option.value === hours)) {
      $('#archive-hours').add(new Option(`${hours} 小时`, hours));
    }
    $('#archive-hours').value = hours;
  }
  const selected = $('#rule-workspace').value || currentWorkspace;
  $('#rule-workspace').replaceChildren(...data.state.workspaces.map(item => new Option(item.name, item.id)));
  if (data.state.workspaces.some(item => item.id === selected)) $('#rule-workspace').value = selected;
  $('#rules').replaceChildren();
  for (const rule of data.state.rules) {
    const item = element('div', 'row');
    item.append(element('span', 'row-content hint', `${rule.domain} → ${workspaceName(rule.workspaceId)}`));
    item.append(button('×', `删除 ${rule.domain} 路由`, () => action('RULE_DELETE', { ruleId: rule.id }, '路由已删除')));
    $('#rules').append(item);
  }
}

function renderSearch(query) {
  const resources = data.state.workspaces.flatMap(owner => owner.resources.map(item => ({ ...item, kind: 'resource', owner: owner.id, workspaceName: owner.name })));
  const tabs = data.tabs.map(tab => ({ ...tab, kind: 'tab', workspaceName: workspaceName(data.session.groups.find(group => group.groupId === tab.groupId && group.windowId === tab.windowId)?.workspaceId) }));
  const archived = data.state.archive.map(item => ({ ...item, kind: 'archive', workspaceName: '归档' }));
  const matches = searchItems([...tabs, ...resources, ...archived], query);
  $('#search-results').replaceChildren(...matches.slice(0, 100).map(item => row(item, item.kind, item.owner)));
  $('#search-count').textContent = matches.length > 100 ? `前 100 / ${matches.length}` : matches.length;
  if (!matches.length) empty($('#search-results'), '没有找到匹配的网页', '试试标题、域名或文件夹名称。');
}

function render() {
  if (!data) return;
  if (!data.state.workspaces.some(item => item.id === currentWorkspace)) currentWorkspace = data.state.workspaces[0].id;
  const query = $('#search').value.trim();
  for (const name of ['workspace', 'archive', 'settings', 'search']) $(`#${name}-view`).hidden = query ? name !== 'search' : name !== view;
  document.querySelectorAll('[data-view]').forEach(node => {
    node.classList.toggle('selected', node.dataset.view === view && !query);
    node.setAttribute('aria-current', node.dataset.view === view && !query ? 'page' : 'false');
  });
  $('#archive-count').textContent = data.state.archive.length;
  $('#archive-status').textContent = data.state.settings.autoArchive ? `闲置 ${data.state.settings.archiveHours} 小时后归档` : '自动归档已暂停';
  if (query) renderSearch(query);
  else if (view === 'workspace') renderWorkspaces();
  else if (view === 'settings') renderSettings();
  else {
    $('#archive-list').replaceChildren(...data.state.archive.map(item => row(item, 'archive')));
    if (!data.state.archive.length) empty($('#archive-list'), '还没有归档的网页', '归档标签后，会出现在这里。');
  }
}

async function refresh() {
  const version = ++refreshVersion;
  const result = await request('READ');
  if (version !== refreshVersion) return;
  data = result;
  if (!currentWorkspace) currentWorkspace = data.session.active.find(item => item.windowId === targetWindow)?.workspaceId || data.state.workspaces[0].id;
  render();
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => run(refresh), 120);
}

function openResourceDialog(page = {}) {
  const form = $('#resource-form');
  form.reset();
  form.elements.title.value = page.title || '';
  form.elements.url.value = page.url || '';
  $('#folder-names').replaceChildren(...[...new Set(workspace().resources.map(item => item.folder).filter(Boolean))].map(name => new Option(name)));
  $('#resource-dialog').showModal();
}

document.querySelectorAll('[data-view]').forEach(node => node.addEventListener('click', () => {
  view = node.dataset.view;
  $('#search').value = '';
  render();
}));
$('#search').addEventListener('input', render);
document.querySelectorAll('[data-close]').forEach(node => node.addEventListener('click', () => node.closest('dialog').close()));
$('#new-workspace').addEventListener('click', () => {
  editingWorkspace = null;
  $('#workspace-form').reset();
  $('#workspace-dialog-title').textContent = '新建工作区';
  $('#delete-workspace').hidden = true;
  $('#workspace-dialog').showModal();
});
$('#edit-workspace').addEventListener('click', () => {
  editingWorkspace = currentWorkspace;
  const item = workspace();
  $('#workspace-form').elements.name.value = item.name;
  const select = $('#workspace-form').elements.color;
  if (![...select.options].some(option => option.value === item.color) && COLORS.includes(item.color)) select.add(new Option(item.color, item.color));
  select.value = item.color;
  $('#workspace-dialog-title').textContent = '编辑工作区';
  $('#delete-workspace').hidden = data.state.workspaces.length < 2;
  $('#workspace-dialog').showModal();
});
$('#workspace-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const values = Object.fromEntries(new FormData(event.target));
    const result = await request(editingWorkspace ? 'WORKSPACE_RENAME' : 'WORKSPACE_CREATE', { ...values, workspaceId: editingWorkspace });
    if (!editingWorkspace) currentWorkspace = result.id;
    $('#workspace-dialog').close();
    await refresh();
    notify('工作区已保存');
  });
});
$('#delete-workspace').addEventListener('click', () => run(async () => {
  if (!confirm(`删除“${workspace().name}”及其常用链接和快照？打开的页面和归档记录会保留。`)) return;
  await action('WORKSPACE_DELETE', { workspaceId: editingWorkspace }, '工作区已删除');
  $('#workspace-dialog').close();
}));
$('#new-resource').addEventListener('click', () => { if (data) openResourceDialog(); });
$('#save-current').addEventListener('click', () => run(async () => {
  const tabs = await chrome.tabs.query({ windowId: targetWindow, active: true });
  if (!tabs.length) throw new Error('当前窗口没有可保存的页面。');
  openResourceDialog(tabs[0]);
}));
$('#resource-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    await action('RESOURCE_ADD', { workspaceId: currentWorkspace, ...Object.fromEntries(new FormData(event.target)) }, '已保存到常用链接');
    $('#resource-dialog').close();
  });
});
$('#save-snapshot').addEventListener('click', () => run(async () => {
  if (workspace().snapshot && !confirm('用当前工作区标签覆盖上一份快照？')) return;
  await action('SNAPSHOT_SAVE', { workspaceId: currentWorkspace }, '工作区快照已保存');
}));
$('#settings-form').addEventListener('input', () => { settingsDirty = true; });
$('#settings-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    await request('SETTINGS_SAVE', { settings: { autoArchive: $('#auto-archive').checked, archiveHours: Number($('#archive-hours').value) } });
    settingsDirty = false;
    await refresh();
    notify('设置已保存');
  });
});
$('#rule-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    await action('RULE_SAVE', Object.fromEntries(new FormData(event.target)), '路由已保存，下次打开匹配网址时生效');
    event.target.elements.domain.value = '';
  });
});
$('#export').addEventListener('click', () => run(async () => {
  const backup = await request('EXPORT');
  const url = URL.createObjectURL(new Blob([backup], { type: 'application/json' }));
  const link = element('a');
  link.href = url;
  link.download = `ama-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}));
$('#import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', event => run(async () => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > MAX_BACKUP_BYTES) throw new Error('备份文件不能超过 2 MB。');
  let backup;
  try { backup = JSON.parse(await file.text()); } catch { throw new Error('无法读取 JSON 备份文件。'); }
  await action('IMPORT', { backup }, '数据已合并，原有设置已保留');
}));

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'session' && changes.amaError?.newValue) {
    showBackgroundError(changes.amaError.newValue);
  }
  scheduleRefresh();
});
for (const event of [chrome.tabs.onCreated, chrome.tabs.onUpdated, chrome.tabs.onRemoved,
  chrome.tabs.onActivated, chrome.tabs.onMoved, chrome.tabGroups.onUpdated, chrome.tabGroups.onRemoved]) {
  event.addListener(scheduleRefresh);
}
chrome.runtime.onMessage.addListener(message => {
  if (!isOptionsPage && message.type === 'FOCUS_SEARCH' && message.windowId === targetWindow) $('#search').focus();
});
run(async () => {
  targetWindow = (await chrome.windows.getCurrent()).id;
  await refresh();
  if (!isOptionsPage) $('#search').focus();
  const { amaError } = await chrome.storage.session.get('amaError');
  showBackgroundError(amaError);
});
