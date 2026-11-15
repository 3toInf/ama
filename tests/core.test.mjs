import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, validateUrl, searchItems, canArchive, mergeBackup, exportBackup,
  matchesDomain, validateSettings,
  serializeBackup, MAX_BACKUP_BYTES,
} from '../extension/core.js';

const now = 1_800_000_000_000;
const tab = { id: 1, url: 'https://example.com/article', title: 'Article', active: false,
  pinned: false, audible: false, incognito: false, status: 'complete', lastAccessed: now - 13 * 3600000 };

test('fresh installs do not start closing tabs', () => {
  const state = createState();
  assert.equal(state.settings.autoArchive, false);
  assert.equal(canArchive(tab, state.settings, now, true), false);
  assert.notEqual(createState().workspaces, state.workspaces);
});

test('only complete HTTP URLs are accepted from resources and backups', () => {
  assert.equal(validateUrl('  https://example.com/a?q=1  '), 'https://example.com/a?q=1');
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd',
    'chrome://settings', '//example.com', 'not a URL', 'https://user:secret@example.com', null]) {
    assert.throws(() => validateUrl(url));
  }
});

test('archive age boundary is inclusive and requires a trustworthy timestamp', () => {
  const settings = { autoArchive: true, archiveHours: 12 };
  assert.equal(canArchive({ ...tab, lastAccessed: now - 12 * 3600000 }, settings, now, true), true);
  assert.equal(canArchive({ ...tab, lastAccessed: now - 12 * 3600000 + 1 }, settings, now, true), false);
  for (const lastAccessed of [undefined, 0, NaN, now + 1]) {
    assert.equal(canArchive({ ...tab, lastAccessed }, settings, now, true), false);
  }
});

test('automatic archive protects active, pinned, audible, loading and private pages', () => {
  for (const overrides of [{ active: true }, { pinned: true }, { audible: true },
    { status: 'loading' }, { incognito: true }, { url: 'chrome://settings' }]) {
    assert.equal(canArchive({ ...tab, ...overrides }, { autoArchive: true, archiveHours: 12 }, now, true), false);
  }
});

test('manual archive allows active pages but still protects pinned, audible and private pages', () => {
  assert.equal(canArchive({ ...tab, active: true, lastAccessed: now }, createState().settings, now, false), true);
  for (const overrides of [{ pinned: true }, { audible: true }, { incognito: true }]) {
    assert.equal(canArchive({ ...tab, ...overrides }, createState().settings, now, false), false);
  }
});

test('search matches all words across Unicode titles, folders and URLs', () => {
  const items = [
    { title: 'Chrome API 文档', url: 'https://developer.chrome.com', folder: '开发' },
    { title: 'Travel', url: 'https://example.com', folder: '个人' },
  ];
  assert.deepEqual(searchItems(items, 'chrome 开发'), [items[0]]);
  assert.deepEqual(searchItems(items, 'ＡＰＩ'), [items[0]]);
  assert.deepEqual(searchItems(items, 'missing'), []);
});

test('domain routing respects subdomain boundaries and case', () => {
  assert.equal(matchesDomain('https://docs.github.com/a', 'github.com'), true);
  assert.equal(matchesDomain('https://GITHUB.com/a', 'GitHub.com'), true);
  assert.equal(matchesDomain('https://evilgithub.com', 'github.com'), false);
  assert.equal(matchesDomain('https://github.com.evil.test', 'github.com'), false);
  assert.equal(matchesDomain('javascript:alert(1)', 'github.com'), false);
});

test('settings reject out-of-range and coercible values', () => {
  assert.deepEqual(validateSettings({ autoArchive: true, archiveHours: 24 }), { autoArchive: true, archiveHours: 24 });
  for (const archiveHours of [0, -1, 721, '12', NaN]) {
    assert.throws(() => validateSettings({ autoArchive: true, archiveHours }));
  }
  assert.throws(() => validateSettings({ autoArchive: 'yes', archiveHours: 12 }));
});

function backupFixture() {
  const state = createState();
  state.workspaces[0].resources = [{ id: 'r1', title: '<img src=x onerror=alert(1)>',
    url: 'https://example.com/', folder: '资料' }];
  return exportBackup(state);
}

test('backup import merges resources without duplicating links or changing local settings', () => {
  const current = createState();
  const incoming = backupFixture();
  incoming.data.settings = { autoArchive: true, archiveHours: 1 };
  const merged = mergeBackup(current, incoming);
  assert.equal(current.workspaces[0].resources.length, 0);
  assert.equal(merged.workspaces[0].resources.length, 1);
  assert.equal(merged.settings.autoArchive, false);
  assert.equal(merged.workspaces[0].resources[0].title, '<img src=x onerror=alert(1)>');
  assert.equal(mergeBackup(merged, incoming).workspaces[0].resources.length, 1);
});

test('backup import validates all data before returning and rejects executable URLs', () => {
  const incoming = backupFixture();
  incoming.data.workspaces[0].resources.push({ id: 'r2', title: 'Bad', folder: '', url: 'javascript:alert(1)' });
  const current = createState();
  assert.throws(() => mergeBackup(current, incoming));
  assert.equal(current.workspaces[0].resources.length, 0);
  for (const value of [null, [], {}, { format: 'ama-backup', version: 99, data: {} }]) {
    assert.throws(() => mergeBackup(current, value));
  }
});

test('unknown workspace references and oversized resource lists reject the backup', () => {
  const incoming = backupFixture();
  incoming.data.archive = [{ id: 'a', workspaceId: 'unknown', url: 'https://example.com/', title: 'A', archivedAt: now }];
  assert.throws(() => mergeBackup(createState(), incoming));
  const oversized = backupFixture();
  oversized.data.workspaces[0].resources = Array(2001).fill(oversized.data.workspaces[0].resources[0]);
  assert.throws(() => mergeBackup(createState(), oversized));
});

test('name collisions merge safely while duplicate IDs within an import are rejected', () => {
  const incoming = backupFixture();
  incoming.data.workspaces.push({ ...structuredClone(incoming.data.workspaces[0]), name: 'Other' });
  assert.throws(() => mergeBackup(createState(), incoming));
});

test('exports never contain ephemeral Chrome window or tab group bindings', () => {
  const state = createState();
  state.bindings = { '10': { groupId: 999 } };
  const backup = exportBackup(state);
  assert.equal(backup.format, 'ama-backup');
  assert.equal('bindings' in backup.data, false);
  assert.doesNotThrow(() => mergeBackup(createState(), backup));
});

test('downloaded backup bytes remain importable even near the file-size limit', () => {
  const state = createState();
  state.workspaces[0].resources = Array.from({ length: 1900 }, (_, i) => ({
    id: `r${i}`, title: 't'.repeat(100), url: `https://example.com/${i}/${'a'.repeat(870)}`, folder: '',
  }));
  assert.ok(Buffer.byteLength(JSON.stringify(exportBackup(state), null, 2)) > MAX_BACKUP_BYTES);
  const downloaded = serializeBackup(state);
  assert.ok(Buffer.byteLength(downloaded) <= MAX_BACKUP_BYTES);
  const restored = mergeBackup(createState(), JSON.parse(downloaded));
  assert.equal(restored.workspaces[0].resources.length, 1900);
});

test('import combines two nonempty snapshots instead of losing incoming URLs', () => {
  const current = createState();
  current.workspaces[0].snapshot = { savedAt: now, tabs: [{ title: 'Local', url: 'https://local.example/' }] };
  const incoming = createState();
  incoming.workspaces[0].snapshot = { savedAt: now - 1000, tabs: [
    { title: 'Incoming', url: 'https://incoming.example/' }, { title: 'Duplicate', url: 'https://local.example/' },
  ] };
  const merged = mergeBackup(current, exportBackup(incoming));
  assert.deepEqual(merged.workspaces[0].snapshot.tabs.map(page => page.url), ['https://local.example/', 'https://incoming.example/']);
  assert.equal(current.workspaces[0].snapshot.tabs.length, 1);
});

test('an oversized combined snapshot rejects atomically', () => {
  const current = createState();
  current.workspaces[0].snapshot = { savedAt: now, tabs: Array.from({ length: 500 }, (_, i) => ({ title: `Local ${i}`, url: `https://local.example/${i}` })) };
  const incoming = createState();
  incoming.workspaces[0].snapshot = { savedAt: now, tabs: [{ title: 'Extra', url: 'https://incoming.example/' }] };
  assert.throws(() => mergeBackup(current, exportBackup(incoming)), /500/);
  assert.equal(current.workspaces[0].snapshot.tabs.length, 500);
});
