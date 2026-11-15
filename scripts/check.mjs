import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const extension = join(root, 'extension');
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background.type, 'module');
for (const path of [manifest.background.service_worker, manifest.side_panel.default_path, manifest.options_ui.page.split('?')[0]]) {
  await access(join(extension, path));
}
let count = 0;
async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { await checkDirectory(path); continue; }
    if (!/\.(?:m?js)$/u.test(entry.name)) continue;
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || `Cannot parse ${path}`);
    count++;
  }
}
await checkDirectory(extension);
await checkDirectory(join(root, 'tests'));
await checkDirectory(join(root, 'scripts'));
for (const name of await readdir(extension)) {
  if (!/\.(?:html|css|js)$/u.test(name)) continue;
  const source = await readFile(join(extension, name), 'utf8');
  const references = name.endsWith('.html') ? [...source.matchAll(/(?:src|href)="([^"#]+)"/gu)].map(match => match[1])
    : name.endsWith('.css') ? [...source.matchAll(/@import url\(['"]([^'"]+)['"]\)/gu)].map(match => match[1])
    : [...source.matchAll(/from ['"]([.][^'"]+)['"]/gu)].map(match => match[1]);
  for (const reference of references) {
    assert.ok(!/^https?:/u.test(reference), `Remote asset in ${name}`);
    await access(resolve(extension, reference));
  }
}
console.log(`Manifest and packaged assets validated; ${count} JavaScript files parsed successfully.`);
