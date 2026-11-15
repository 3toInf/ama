import { COLORS, createState, text, uid, validateUrl, validateSettings, canArchive,
  normalizeDomain, matchesDomain, serializeBackup, mergeBackup } from './core.js';

export function createController(api, { now = () => Date.now() } = {}) {
  let queue = Promise.resolve();
  const enqueue = task => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };
  const load = async () => {
    const state = (await api.storage.local.get('ama')).ama;
    if (state && state.version !== 1) throw new Error('数据版本不受支持，请更新 AMA。');
    return state ?? createState();
  };
  const save = state => {
    serializeBackup(state); // Keep every persisted state within the portable backup limit.
    return api.storage.local.set({ ama: state });
  };
  const sessionLoad = async () => (await api.storage.session.get('amaSession')).amaSession ?? { groups: [], active: [] };
  const sessionSave = session => api.storage.session.set({ amaSession: session });
  const workspaceFor = (state, id) => {
    const workspace = state.workspaces.find(item => item.id === id);
    if (!workspace) throw new Error('工作区不存在，请刷新后重试。');
    return workspace;
  };
  const windowId = value => {
    if (!Number.isInteger(value) || value < 0) throw new Error('无法确定目标浏览器窗口。');
    return value;
  };

  async function liveBindings(session) {
    const groups = await api.tabGroups.query({});
    session.groups = session.groups.filter(binding => groups.some(group =>
      group.id === binding.groupId && group.windowId === binding.windowId));
    return session;
  }

  async function addToGroup(state, session, tab, workspaceId) {
    const workspace = workspaceFor(state, workspaceId);
    if (tab.incognito || tab.pinned) throw new Error('隐身标签和固定标签不能收入工作区，请先取消固定。');
    await liveBindings(session);
    let binding = session.groups.find(item => item.workspaceId === workspaceId && item.windowId === tab.windowId);
    if (!binding) {
      const groupId = await api.tabs.group({ tabIds: [tab.id], createProperties: { windowId: tab.windowId } });
      binding = { workspaceId, windowId: tab.windowId, groupId };
      session.groups.push(binding);
      await sessionSave(session);
    } else if (tab.groupId !== binding.groupId) {
      await api.tabs.group({ tabIds: [tab.id], groupId: binding.groupId });
    }
    await api.tabGroups.update(binding.groupId, { title: workspace.name, color: workspace.color });
    return binding.groupId;
  }

  async function workspaceTabs(session, workspaceId, targetWindow) {
    await liveBindings(session);
    const binding = session.groups.find(item => item.workspaceId === workspaceId && item.windowId === targetWindow);
    return binding ? api.tabs.query({ windowId: targetWindow, groupId: binding.groupId }) : [];
  }

  async function openPage(state, session, page, workspaceId, targetWindow, active = true) {
    windowId(targetWindow);
    const url = validateUrl(page.url);
    if (workspaceId) {
      workspaceFor(state, workspaceId);
      const existing = (await workspaceTabs(session, workspaceId, targetWindow)).find(tab => tab.url === url);
      if (existing) {
        if (active) await api.tabs.update(existing.id, { active: true });
        return existing;
      }
    }
    const tab = await api.tabs.create({ windowId: targetWindow, url, active });
    if (workspaceId) await addToGroup(state, session, tab, workspaceId);
    return tab;
  }

  async function archiveTab(state, session, tabId, automatic) {
    let tab;
    try { tab = await api.tabs.get(tabId); } catch { return { skipped: true }; }
    const protectedResource = () => state.workspaces.some(workspace => workspace.resources.some(resource => resource.url === tab.url));
    if (!canArchive(tab, state.settings, now(), automatic) || (automatic && protectedResource())) {
      if (automatic) return { skipped: true };
      throw new Error('此页面正在播放音频、已固定、正在加载或不支持归档。');
    }
    if (state.archive.length >= 2000) throw new Error('归档已满，请先导出并整理归档。');
    const binding = session.groups.find(item => item.groupId === tab.groupId && item.windowId === tab.windowId);
    const item = { id: uid(), url: validateUrl(tab.url), title: (tab.title || tab.url).slice(0, 500),
      workspaceId: binding?.workspaceId ?? null, archivedAt: now(), reason: automatic ? 'auto' : 'manual' };
    state.archive.unshift(item);
    await save(state); // A failed write must never close the page.
    try { tab = await api.tabs.get(tabId); } catch { return { archived: true }; }
    if (tab.url !== item.url || !canArchive(tab, state.settings, now(), automatic) || (automatic && protectedResource())) {
      state.archive = state.archive.filter(entry => entry.id !== item.id);
      await save(state);
      return { skipped: true };
    }
    await api.tabs.remove(tabId); // On failure, keep the persisted recovery record.
    return { archived: true };
  }

  async function handle(message) {
    if (!message || typeof message.type !== 'string') throw new Error('请求格式错误。');
    const state = await load();
    const session = await liveBindings(await sessionLoad());
    switch (message.type) {
      case 'READ': {
        const target = windowId(message.windowId);
        return { state, session, tabs: (await api.tabs.query({ windowId: target })).filter(tab => !tab.incognito) };
      }
      case 'WORKSPACE_CREATE': {
        if (state.workspaces.length >= 200) throw new Error('最多创建 200 个工作区。');
        const name = text(message.name);
        if (state.workspaces.some(item => item.name === name)) throw new Error('已有同名工作区。');
        const workspace = { id: uid(), name, color: COLORS.includes(message.color) ? message.color : 'purple', resources: [], snapshot: null };
        state.workspaces.push(workspace);
        await save(state);
        return workspace;
      }
      case 'WORKSPACE_RENAME': {
        const workspace = workspaceFor(state, message.workspaceId);
        const name = text(message.name);
        if (state.workspaces.some(item => item.id !== workspace.id && item.name === name)) throw new Error('已有同名工作区。');
        workspace.name = name;
        if (COLORS.includes(message.color)) workspace.color = message.color;
        await save(state);
        for (const group of session.groups.filter(item => item.workspaceId === workspace.id)) {
          await api.tabGroups.update(group.groupId, { title: workspace.name, color: workspace.color });
        }
        return workspace;
      }
      case 'WORKSPACE_DELETE': {
        workspaceFor(state, message.workspaceId);
        if (state.workspaces.length === 1) throw new Error('至少保留一个工作区。');
        for (const group of session.groups.filter(item => item.workspaceId === message.workspaceId)) {
          const tabs = await api.tabs.query({ groupId: group.groupId });
          if (tabs.length) await api.tabs.ungroup(tabs.map(tab => tab.id));
        }
        state.workspaces = state.workspaces.filter(item => item.id !== message.workspaceId);
        state.rules = state.rules.filter(item => item.workspaceId !== message.workspaceId);
        state.archive.forEach(item => { if (item.workspaceId === message.workspaceId) item.workspaceId = null; });
        session.groups = session.groups.filter(item => item.workspaceId !== message.workspaceId);
        session.active = session.active.filter(item => item.workspaceId !== message.workspaceId);
        await save(state);
        await sessionSave(session);
        return {};
      }
      case 'WORKSPACE_SWITCH': {
        workspaceFor(state, message.workspaceId);
        const target = windowId(message.windowId);
        const tabs = await workspaceTabs(session, message.workspaceId, target);
        // Focus first, so Chrome permits collapsing the previously active group.
        if (tabs.length) await api.tabs.update((tabs.find(tab => tab.active) ?? tabs[0]).id, { active: true });
        for (const binding of session.groups.filter(item => item.windowId === target)) {
          if (!tabs.length && binding.workspaceId !== message.workspaceId) continue;
          await api.tabGroups.update(binding.groupId, { collapsed: binding.workspaceId !== message.workspaceId });
        }
        session.active = session.active.filter(item => item.windowId !== target);
        session.active.push({ windowId: target, workspaceId: message.workspaceId });
        await sessionSave(session);
        return {};
      }
      case 'TAB_MOVE':
        await addToGroup(state, session, await api.tabs.get(message.tabId), message.workspaceId);
        return {};
      case 'TAB_FOCUS': {
        const tab = await api.tabs.get(message.tabId);
        await api.windows.update(tab.windowId, { focused: true });
        await api.tabs.update(tab.id, { active: true });
        return {};
      }
      case 'RESOURCE_ADD': {
        const workspace = workspaceFor(state, message.workspaceId);
        const url = validateUrl(message.url);
        const folder = message.folder ? text(message.folder) : '';
        const title = text(message.title || new URL(url).hostname, 500);
        const existing = workspace.resources.find(item => item.url === url && item.folder === folder);
        if (existing) return existing;
        if (workspace.resources.length >= 2000) throw new Error('此工作区常用链接已满。');
        const resource = { id: uid(), url, title, folder };
        workspace.resources.push(resource);
        await save(state);
        return resource;
      }
      case 'RESOURCE_REMOVE': {
        const workspace = workspaceFor(state, message.workspaceId);
        workspace.resources = workspace.resources.filter(item => item.id !== message.resourceId);
        await save(state);
        return {};
      }
      case 'RESOURCE_OPEN': {
        const resource = workspaceFor(state, message.workspaceId).resources.find(item => item.id === message.resourceId);
        if (!resource) throw new Error('链接不存在。');
        return openPage(state, session, resource, message.workspaceId, message.windowId);
      }
      case 'TAB_ARCHIVE': return archiveTab(state, session, message.tabId, false);
      case 'ARCHIVE_RESTORE': {
        const item = state.archive.find(entry => entry.id === message.archiveId);
        if (!item) throw new Error('归档记录不存在。');
        const tab = await openPage(state, session, item, item.workspaceId, message.windowId);
        state.archive = state.archive.filter(entry => entry.id !== item.id);
        await save(state);
        return tab;
      }
      case 'ARCHIVE_DELETE':
        state.archive = state.archive.filter(item => item.id !== message.archiveId);
        await save(state);
        return {};
      case 'SNAPSHOT_SAVE': {
        const workspace = workspaceFor(state, message.workspaceId);
        const tabs = await workspaceTabs(session, workspace.id, windowId(message.windowId));
        const pages = tabs.flatMap(tab => {
          try { return [{ url: validateUrl(tab.url), title: (tab.title || tab.url).slice(0, 500) }]; } catch { return []; }
        });
        if (!pages.length) throw new Error('工作区还没有可保存的网页。');
        if (pages.length > 500) throw new Error('每份快照最多保存 500 个网页。');
        workspace.snapshot = { savedAt: now(), tabs: pages };
        await save(state);
        return { count: pages.length };
      }
      case 'SNAPSHOT_RESTORE': {
        const workspace = workspaceFor(state, message.workspaceId);
        if (!workspace.snapshot) throw new Error('还没有保存快照。');
        for (const page of workspace.snapshot.tabs) await openPage(state, session, page, workspace.id, message.windowId, false);
        return {};
      }
      case 'RULE_SAVE': {
        workspaceFor(state, message.workspaceId);
        const domain = normalizeDomain(message.domain);
        const rule = state.rules.find(item => item.domain === domain);
        if (rule) rule.workspaceId = message.workspaceId;
        else {
          if (state.rules.length >= 100) throw new Error('最多保存 100 条路由。');
          state.rules.push({ id: uid(), domain, workspaceId: message.workspaceId });
        }
        await save(state);
        return {};
      }
      case 'RULE_DELETE':
        state.rules = state.rules.filter(item => item.id !== message.ruleId);
        await save(state);
        return {};
      case 'SETTINGS_SAVE':
        state.settings = validateSettings(message.settings);
        await save(state);
        return {};
      case 'EXPORT': return serializeBackup(state);
      case 'IMPORT': {
        const merged = mergeBackup(state, message.backup);
        await save(merged);
        return { workspaces: merged.workspaces.length };
      }
      case 'PEEK':
        return api.windows.create({ url: validateUrl(message.url), type: 'popup', width: 900, height: 700 });
      default: throw new Error('不支持的操作。');
    }
  }

  return {
    dispatch: message => enqueue(() => handle(message)),
    resetSession: () => enqueue(() => sessionSave({ groups: [], active: [] })),
    sweep: () => enqueue(async () => {
      const state = await load();
      if (!state.settings.autoArchive) return { count: 0, errors: [] };
      const session = await liveBindings(await sessionLoad());
      const candidates = (await api.tabs.query({})).filter(tab => canArchive(tab, state.settings, now(), true));
      let count = 0;
      const errors = [];
      for (const tab of candidates) {
        try { if ((await archiveTab(state, session, tab.id, true)).archived) count++; }
        catch (error) { errors.push(error.message); break; }
      }
      return { count, errors };
    }),
    route: tabId => enqueue(async () => {
      const state = await load();
      if (!state.rules.length) return;
      let tab;
      try { tab = await api.tabs.get(tabId); } catch { return; }
      if (tab.pinned || tab.incognito) return;
      const rule = [...state.rules].sort((a, b) => b.domain.length - a.domain.length)
        .find(item => matchesDomain(tab.url, item.domain));
      if (rule) await addToGroup(state, await sessionLoad(), tab, rule.workspaceId);
    }),
  };
}
