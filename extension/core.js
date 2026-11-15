export const COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
export const uid = () => crypto.randomUUID();

export function createState() {
  return {
    version: 1,
    settings: { autoArchive: false, archiveHours: 12 },
    workspaces: [{ id: 'home', name: '日常', color: 'purple', resources: [], snapshot: null }],
    archive: [],
    rules: [],
  };
}

export function text(value, maximum = 80) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new Error(`请输入 1–${maximum} 个字符。`);
  }
  return value.trim();
}

export function validateUrl(value) {
  const input = text(value, 8192);
  let parsed;
  try { parsed = new URL(input); } catch { throw new Error('请输入完整的 http 或 https 网址。'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('只支持不含登录凭据的 http 或 https 网址。');
  }
  return parsed.href;
}

export function normalizeDomain(value) {
  const input = text(value, 253).toLowerCase().replace(/\.$/, '');
  if (/[\s/:?#@*]/u.test(input)) throw new Error('域名不能包含协议、路径或通配符。');
  const hostname = new URL(`https://${input}`).hostname;
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/u.test(hostname)) throw new Error('域名格式不正确。');
  return hostname;
}

export function matchesDomain(url, domain) {
  try {
    const host = new URL(validateUrl(url)).hostname.toLowerCase();
    const target = normalizeDomain(domain);
    return host === target || host.endsWith(`.${target}`);
  } catch { return false; }
}

export function validateSettings(settings) {
  if (typeof settings?.autoArchive !== 'boolean' || !Number.isFinite(settings.archiveHours)
    || settings.archiveHours < 1 || settings.archiveHours > 720) {
    throw new Error('归档时间应为 1–720 小时，自动归档开关必须明确设置。');
  }
  return { autoArchive: settings.autoArchive, archiveHours: settings.archiveHours };
}

export function canArchive(tab, settings, now, automatic = true) {
  try { validateUrl(tab.url); } catch { return false; }
  if (tab.incognito || tab.pinned || tab.audible || tab.status === 'loading') return false;
  if (!automatic) return true;
  return settings.autoArchive === true && !tab.active
    && Number.isFinite(tab.lastAccessed) && tab.lastAccessed > 0 && tab.lastAccessed <= now
    && now - tab.lastAccessed >= settings.archiveHours * 3600000;
}

export function searchItems(items, query) {
  const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase();
  const terms = normalize(query).trim().split(/\s+/u).filter(Boolean);
  return items.filter(item => {
    const haystack = normalize([item.title, item.url, item.folder, item.workspaceName].join(' '));
    return terms.every(term => haystack.includes(term));
  });
}

function list(value, maximum, label) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label}结构错误或超过 ${maximum} 条。`);
  return value;
}

function page(value) {
  if (!value || typeof value !== 'object') throw new Error('网页记录格式错误。');
  const url = validateUrl(value.url);
  return { url, title: text(value.title || new URL(url).hostname, 500) };
}

function checkBackup(input) {
  if (!input || input.format !== 'ama-backup' || input.version !== 1 || input.data?.version !== 1) {
    throw new Error('这不是受支持的 AMA 备份文件。');
  }
  if (new TextEncoder().encode(JSON.stringify(input)).length > MAX_BACKUP_BYTES) {
    throw new Error('备份文件不能超过 2 MB。');
  }
  const ids = new Set();
  const workspaces = list(input.data.workspaces, 200, '工作区').map(workspace => {
    const id = text(workspace?.id, 100);
    if (ids.has(id)) throw new Error('备份内存在重复的工作区 ID。');
    ids.add(id);
    const resources = list(workspace.resources, 2000, '常用链接').map(resource => ({
      ...page(resource), id: uid(), folder: resource.folder ? text(resource.folder) : '',
    }));
    let snapshot = null;
    if (workspace.snapshot != null) {
      if (!Number.isFinite(workspace.snapshot.savedAt) || workspace.snapshot.savedAt < 0) throw new Error('快照时间无效。');
      snapshot = { savedAt: workspace.snapshot.savedAt, tabs: list(workspace.snapshot.tabs, 500, '快照').map(page) };
    }
    return { id, name: text(workspace.name), color: COLORS.includes(workspace.color) ? workspace.color : 'purple', resources, snapshot };
  });
  if (!workspaces.length) throw new Error('备份必须包含至少一个工作区。');
  const reference = id => {
    if (id !== null && !ids.has(id)) throw new Error('备份引用了不存在的工作区。');
    return id;
  };
  const archive = list(input.data.archive, 2000, '归档').map(item => {
    if (!Number.isFinite(item.archivedAt) || item.archivedAt < 0) throw new Error('归档时间无效。');
    return { ...page(item), id: uid(), workspaceId: reference(item.workspaceId), archivedAt: item.archivedAt, reason: 'import' };
  });
  const rules = list(input.data.rules, 100, '路由规则').map(rule => ({
    id: uid(), domain: normalizeDomain(rule.domain), workspaceId: reference(rule.workspaceId),
  }));
  if (rules.some(rule => rule.workspaceId === null)) throw new Error('路由必须指定工作区。');
  return { workspaces, archive, rules };
}

export function exportBackup(state) {
  return { format: 'ama-backup', version: 1, exportedAt: new Date().toISOString(), data: structuredClone({
    version: 1, workspaces: state.workspaces, archive: state.archive, rules: state.rules,
  }) };
}

export function serializeBackup(state) {
  const serialized = JSON.stringify(exportBackup(state));
  if (new TextEncoder().encode(serialized).length > MAX_BACKUP_BYTES) {
    throw new Error('数据总量不能超过 2 MB，请先整理链接、快照或归档。');
  }
  return serialized;
}

export function mergeBackup(current, input) {
  const incoming = checkBackup(input); // Validate everything before changing any state.
  const result = structuredClone(current);
  const mapping = new Map();
  for (const source of incoming.workspaces) {
    let target = result.workspaces.find(workspace => workspace.name === source.name);
    if (!target) {
      target = { ...source, id: uid(), resources: [] };
      result.workspaces.push(target);
    }
    mapping.set(source.id, target.id);
    for (const resource of source.resources) {
      if (!target.resources.some(existing => existing.url === resource.url && existing.folder === resource.folder)) {
        target.resources.push(resource);
      }
    }
    if (source.snapshot) {
      const tabs = [...(target.snapshot?.tabs ?? [])];
      const urls = new Set(tabs.map(tab => tab.url));
      for (const tab of source.snapshot.tabs) {
        if (!urls.has(tab.url)) {
          tabs.push(tab);
          urls.add(tab.url);
        }
      }
      if (tabs.length > 500) throw new Error('合并后的快照超过 500 个页面。');
      target.snapshot = { savedAt: Math.max(target.snapshot?.savedAt ?? 0, source.snapshot.savedAt), tabs };
    }
    if (target.resources.length > 2000) throw new Error('合并后的工作区超过 2000 个链接。');
  }
  for (const item of incoming.archive) {
    const workspaceId = item.workspaceId === null ? null : mapping.get(item.workspaceId);
    if (!result.archive.some(existing => existing.url === item.url && existing.workspaceId === workspaceId)) {
      result.archive.push({ ...item, workspaceId });
    }
  }
  for (const rule of incoming.rules) {
    if (!result.rules.some(existing => existing.domain === rule.domain)) {
      result.rules.push({ ...rule, workspaceId: mapping.get(rule.workspaceId) });
    }
  }
  if (result.workspaces.length > 200 || result.archive.length > 2000 || result.rules.length > 100) {
    throw new Error('合并后的数据超过容量限制，请先整理现有数据。');
  }
  return result;
}
