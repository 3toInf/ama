import { text, validateUrl, searchItems } from './core.js';

export function inputIntent(value) {
  const input = text(value, 8192);
  if (/^localhost(?::\d+)?(?:[/?#]|$)/iu.test(input)) return { kind: 'url', url: validateUrl(`http://${input}`) };
  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(input) || /^(?:https?|javascript|vbscript|data|file|about|chrome|chrome-extension|mailto):/iu.test(input)) {
    return { kind: 'url', url: validateUrl(input) };
  }
  if (/^(?:(?:[a-z\d-]+\.)+[a-z]{2,}|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?(?:[/?#]|$)/iu.test(input) && !/\s/u.test(input)) {
    return { kind: 'url', url: validateUrl(`https://${input}`) };
  }
  return { kind: 'search', text: input };
}

export function paletteItems(data, query, workspaceId) {
  const term = query.trim();
  const commandsOnly = term.startsWith('>');
  const workspace = data.state.workspaces.find(item => item.id === workspaceId) ?? data.state.workspaces[0];
  const command = (id, title, detail, type, extra = {}) => ({ id, kind: 'command', title, detail,
    action: { type, workspaceId: workspace.id, ...extra } });
  const commands = [
    command('new-tab', '新建标签页', 'New tab', 'NEW_TAB'),
    command('save-current', '保存当前页', 'Save current page', 'SAVE_CURRENT'),
    command('settings', '打开 AMA 设置', 'Open settings', 'OPEN_SETTINGS'),
  ];
  const items = commandsOnly ? commands : [
    ...[...data.tabs].sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0)).map(tab => ({
      id: `tab:${tab.id}`, kind: 'tab', title: tab.title || tab.url || '新标签页', detail: tab.url || '',
      action: { type: 'TAB_FOCUS', tabId: tab.id },
    })),
    ...data.state.workspaces.flatMap(owner => owner.resources.map(resource => ({
      id: `resource:${owner.id}:${resource.id}`, kind: 'resource', title: resource.title,
      detail: `${owner.name} · ${resource.folder || '常用链接'} · ${resource.url}`,
      action: { type: 'RESOURCE_OPEN', workspaceId: owner.id, resourceId: resource.id },
    }))),
    ...data.state.workspaces.map(owner => ({ id: `workspace:${owner.id}`, kind: 'workspace', title: owner.name,
      detail: '切换工作区 · Switch workspace', action: { type: 'WORKSPACE_SWITCH', workspaceId: owner.id } })),
    ...data.state.archive.map(item => ({ id: `archive:${item.id}`, kind: 'archive', title: item.title,
      detail: `恢复归档 · ${item.url}`, action: { type: 'ARCHIVE_RESTORE', archiveId: item.id } })),
    ...commands,
  ];
  const filtered = searchItems(items.map(item => ({ ...item, url: item.detail })), commandsOnly ? term.slice(1) : term).slice(0, 40);
  if (term && !commandsOnly) {
    let intent;
    try { intent = inputIntent(term); }
    catch (error) {
      if (filtered.length) return filtered; // Existing protected tabs can be selected without navigating to that URL.
      throw error;
    }
    filtered.push({ id: 'navigate', kind: 'navigate', title: intent.kind === 'url' ? `打开 ${intent.url}` : `搜索“${intent.text}”`,
      detail: intent.kind === 'url' ? '在当前工作区打开网址' : '使用 Chrome 默认搜索引擎',
      action: { type: 'OPEN_INPUT', input: term, workspaceId: workspace.id } });
  }
  return filtered;
}
