import test from 'node:test';
import assert from 'node:assert/strict';
import { faviconUrl } from '../extension/icons.js';
import { paletteItems } from '../extension/palette-model.js';
import { createState } from '../extension/core.js';

const runtime = { getURL: path => `chrome-extension://ama${path}` };
test('favicons use the extension cache and preserve encoded page URLs', () => {
  const page = 'https://example.com/文档?q=a&next=https://other.test/#section';
  const url = new URL(faviconUrl(page, runtime));
  assert.equal(url.protocol, 'chrome-extension:');
  assert.equal(url.hostname, 'ama');
  assert.equal(url.pathname, '/_favicon/');
  assert.equal(url.searchParams.get('pageUrl'), new URL(page).href);
  assert.equal(url.searchParams.get('size'), '32');
  assert.equal([...url.searchParams.keys()].length, 2);
});
test('non-web pages and credential-bearing URLs use a local fallback', () => {
  for (const url of [undefined, '', 'not a url', 'chrome://settings/', 'about:blank',
    'file:///private/document', 'javascript:alert(1)', 'data:image/png,x', 'https://user:secret@example.com/']) {
    assert.equal(faviconUrl(url, runtime), null);
  }
});
test('palette preserves real page URLs separately from its searchable descriptions', () => {
  const state = createState();
  state.workspaces[0].resources.push({ id: 'r', title: 'Docs', url: 'https://example.com/docs', folder: '资料' });
  state.archive.push({ id: 'a', title: 'Past', url: 'https://example.com/past' });
  const items = paletteItems({ state, tabs: [{ id: 1, title: 'Live', url: 'https://example.com/live' }] }, '', 'home');
  assert.deepEqual(items.filter(item => ['tab', 'resource', 'archive'].includes(item.kind)).map(item => item.pageUrl),
    ['https://example.com/live', 'https://example.com/docs', 'https://example.com/past']);
});
