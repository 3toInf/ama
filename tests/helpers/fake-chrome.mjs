export function fakeChrome(initialTabs = []) {
  const local = {};
  const session = {};
  const tabs = new Map(initialTabs.map((tab, index) => [tab.id, { index, splitViewId: -1, ...structuredClone(tab) }]));
  const groups = new Map();
  const events = [];
  const searches = [];
  let nextTab = 100;
  let nextGroup = 10;
  let nextSplit = 20;
  const control = { failSave: false, failCreate: false, beforeGet: null, afterSave: null };
  const area = (store, name) => ({
    async get(key) { return { [key]: structuredClone(store[key]) }; },
    async set(values) {
      if (name === 'local' && control.failSave) throw new Error('Storage full');
      Object.assign(store, structuredClone(values));
      events.push(`${name}:save`);
      if (name === 'local') control.afterSave?.();
    },
  });
  const api = {
    storage: { local: area(local, 'local'), session: area(session, 'session') },
    tabs: {
      async query(query) { return [...tabs.values()].filter(tab =>
        Object.entries(query).every(([key, value]) => key === 'currentWindow' || tab[key] === value)
      ).sort((a, b) => a.index - b.index).map(tab => structuredClone(tab)); },
      async get(id) {
        control.beforeGet?.(id);
        if (!tabs.has(id)) throw new Error('No tab');
        return structuredClone(tabs.get(id));
      },
      async create(properties) {
        if (control.failCreate) throw new Error('Cannot open tab');
        const tab = { id: nextTab++, windowId: 1, groupId: -1, active: false, pinned: false,
          audible: false, incognito: false, status: 'complete', splitViewId: -1,
          index: [...tabs.values()].filter(tab => tab.windowId === (properties.windowId ?? 1)).length, ...properties };
        if (tab.active) for (const existing of tabs.values()) if (existing.windowId === tab.windowId) existing.active = false;
        tabs.set(tab.id, tab);
        events.push('tab:create');
        return structuredClone(tab);
      },
      async remove(id) { if (!tabs.has(id)) throw new Error('No tab'); tabs.delete(id); events.push('tab:remove'); },
      async update(id, properties) {
        if (!tabs.has(id)) throw new Error('No tab');
        if (properties.active) for (const tab of tabs.values()) if (tab.windowId === tabs.get(id).windowId) tab.active = false;
        Object.assign(tabs.get(id), properties);
        return structuredClone(tabs.get(id));
      },
      async group({ tabIds, groupId, createProperties }) {
        const selected = tabIds.map(id => tabs.get(id));
        if (selected.some(tab => !tab || tab.pinned)) throw new Error('Cannot group');
        if (groupId !== undefined && !groups.has(groupId)) throw new Error('No group');
        const id = groupId ?? nextGroup++;
        if (groupId === undefined) groups.set(id, { id, windowId: createProperties.windowId, title: '', color: 'grey', collapsed: false });
        if (selected.some(tab => tab.windowId !== groups.get(id).windowId)) throw new Error('Wrong window');
        selected.forEach(tab => { tab.groupId = id; });
        return id;
      },
      async ungroup(ids) { ids.forEach(id => { if (tabs.has(id)) tabs.get(id).groupId = -1; }); },
      async move(id, { index }) {
        const tab = tabs.get(id);
        if (!tab) throw new Error('No tab');
        const ordered = [...tabs.values()].filter(item => item.windowId === tab.windowId && item.id !== id).sort((a, b) => a.index - b.index);
        ordered.splice(index, 0, tab);
        ordered.forEach((item, position) => { item.index = position; });
        events.push('tab:move');
        return structuredClone(tab);
      },
      async createSplit(ids) {
        const pair = ids.map(id => tabs.get(id));
        if (ids.length !== 2 || new Set(ids).size !== 2 || pair.some(tab => !tab || tab.splitViewId >= 0)
          || Math.abs(pair[0].index - pair[1].index) !== 1
          || ['windowId', 'groupId', 'pinned'].some(key => pair[0][key] !== pair[1][key])) throw new Error('Invalid split pair');
        const splitViewId = nextSplit++;
        pair.forEach(tab => { tab.splitViewId = splitViewId; });
        events.push('tab:split');
        return splitViewId;
      },
      async unsplit(id) {
        const pair = [...tabs.values()].filter(tab => tab.splitViewId === id);
        if (pair.length !== 2) throw new Error('No split');
        pair.forEach(tab => { tab.splitViewId = -1; });
        events.push('tab:unsplit');
      },
    },
    tabGroups: {
      async get(id) { if (!groups.has(id)) throw new Error('No group'); return structuredClone(groups.get(id)); },
      async query(query) { return [...groups.values()].filter(group => Object.entries(query).every(([k, v]) => group[k] === v)); },
      async update(id, properties) { if (!groups.has(id)) throw new Error('No group'); Object.assign(groups.get(id), properties); },
    },
    windows: { async update(id, properties) { if (properties.focused) control.focusedWindow = id; }, async create(properties) { events.push('window:create'); return properties; } },
    runtime: { getURL: path => `chrome-extension://ama-test/${path}` },
    search: { async query({ text, tabId }) {
      if (control.failSearch) throw new Error('Search unavailable');
      if (!tabs.has(tabId)) throw new Error('No tab');
      searches.push({ text, tabId });
      tabs.get(tabId).url = `https://search.test/?q=${encodeURIComponent(text)}`;
    } },
  };
  return { api, local, session, tabs, groups, events, control, searches };
}
