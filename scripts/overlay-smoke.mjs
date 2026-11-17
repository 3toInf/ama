import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { mkdir, writeFile, readFile, mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withChrome } from '../tests/helpers/chrome-driver.mjs';

const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><html><head><title>Design Notes · A quieter workspace</title><style>
    *{box-sizing:border-box}body{margin:0;background:#f5f3ef;color:#33343e;font:16px/1.6 system-ui}nav{padding:24px 7%;display:flex;justify-content:space-between;border-bottom:1px solid #ddd}main{max-width:900px;margin:60px auto;padding:0 30px}h1{font-size:48px;line-height:1.15;font-weight:500;letter-spacing:-2px;margin:16px 0}small{color:#777}p{max-width:560px;color:#777}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:40px}.cards div{height:180px;border-radius:16px;padding:24px;background:#e1e5dc}.cards div:nth-child(2){background:#e5dde9}.cards div:nth-child(3){background:#eaddd4}input{font:inherit;border:0;border-radius:7px;padding:10px;background:white}
    </style></head><body><nav><strong>Design Notes</strong><span>Journal &nbsp; Library &nbsp; About</span></nav><main><small>FIELD NOTES / 017</small><h1>A quieter place<br>to think and explore.</h1><p>Collect the useful things. Keep a little space for what comes next.</p><input id="page-input" placeholder="Your notes…" value="Keep my place"><div class="cards"><div>01<br>Workspace studies</div><div>02<br>Things worth keeping</div><div>03<br>New perspectives</div></div></main></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const output = resolve(import.meta.dirname, '../dist/previews');
await mkdir(output, { recursive: true });
// Headless CDP toolbar actions do not grant activeTab. Grant only the local fixture
// origin in a temporary extension copy; production retains activeTab-only access.
const staged = await mkdtemp(join(tmpdir(), 'ama-overlay-extension-'));
await cp(resolve(import.meta.dirname, '../extension'), staged, { recursive: true });
const manifest = JSON.parse(await readFile(join(staged, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*'];
await writeFile(join(staged, 'manifest.json'), JSON.stringify(manifest));
try {
  await withChrome(async ({ send, attach, errors }) => {
    const { id } = await send('Extensions.loadUnpacked', { path: staged });
    const { targetId: panelId } = await send('Target.createTarget', { url: `chrome-extension://${id}/panel.html` });
    const panel = await attach(panelId);
    await panel.until('document.querySelectorAll(".workspace-chip").length === 1', 'panel');
    const { targetId: siteId } = await send('Target.createTarget', { url: base });
    const site = await attach(siteId);
    await site.until(`location.href.startsWith(${JSON.stringify(base)}) && document.readyState==='complete'`, 'fixture page', 30000);
    await send('Page.bringToFront', {}, site.sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false }, site.sessionId);
    const before = await panel.evaluate(`(async () => {
      const windowId=(await chrome.windows.getCurrent()).id;
      const tab=(await chrome.tabs.query({windowId,active:true}))[0];
      globalThis.__overlayTabId=tab.id;
      globalThis.__overlayWindowId=windowId;
      globalThis.openOverlay=async()=>{const r=await chrome.runtime.sendMessage({type:'PALETTE_OPEN',windowId});if(!r.ok)throw new Error(r.error);return r.data;};
      return {windowId,tabId:tab.id,windows:(await chrome.windows.getAll()).length};
    })()`);
    await site.evaluate('document.querySelector("#page-input").focus()');
    const opened = await panel.evaluate('openOverlay()');
    assert.equal(opened.mode, 'overlay', JSON.stringify(opened));
    assert.equal(await panel.evaluate('(async ()=>(await chrome.windows.getAll()).length)()'), before.windows, 'overlay creates no OS window');
    const getPalette = async () => {
      const { targetInfos } = await send('Target.getTargets');
      const target = targetInfos.find(item => item.type === 'iframe' && item.url.startsWith(`chrome-extension://${id}/palette.html?`));
      assert.ok(target, 'isolated extension iframe exists');
      const palette = await attach(target.targetId);
      await palette.until('document.querySelectorAll(".palette-option").length > 0', 'iframe results');
      assert.equal(await palette.evaluate('document.activeElement.id'), 'palette-input');
      return palette;
    };
    let palette = await getPalette();
    await palette.evaluate(`document.querySelector('#palette-input').value='> new tab';document.querySelector('#palette-input').dispatchEvent(new Event('input'))`);
    await palette.until('innerHeight < 250', 'one result shrinks the overlay');
    const shortHeight = await palette.evaluate('innerHeight');
    await palette.evaluate(`document.querySelector('#palette-input').value='';document.querySelector('#palette-input').dispatchEvent(new Event('input'))`);
    await palette.until(`innerHeight > ${shortHeight + 100}`, 'clearing the query expands results again');
    const capture = async name => {
      await site.evaluate('new Promise(resolve=>setTimeout(resolve,180))'); // Finish the short entrance animation before capturing pixels.
      const result = await send('Page.captureScreenshot', { format: 'png' }, site.sessionId);
      await writeFile(`${output}/${name}.png`, Buffer.from(result.data, 'base64'));
    };
    await capture('palette-overlay-light');
    await send('Emulation.setDeviceMetricsOverride', { width: 280, height: 600, deviceScaleFactor: 1, mobile: false }, site.sessionId);
    await palette.until('innerWidth <= 280', 'overlay follows narrow viewport');
    assert.equal(await palette.evaluate('document.documentElement.scrollWidth > innerWidth'), false, 'narrow palette has no horizontal overflow');
    await capture('palette-overlay-narrow');
    await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false }, site.sessionId);
    await palette.until('innerWidth > 600', 'overlay follows expanded viewport');
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, palette.sessionId);
    await capture('palette-overlay-dark');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, palette.sessionId);
    await panel.until(`(async () => !(await chrome.storage.session.get('amaPalette:${before.tabId}'))['amaPalette:${before.tabId}'])()`, 'Escape clears overlay');
    assert.equal(await site.evaluate('document.activeElement.id'), 'page-input', 'Escape restores original page focus');
    assert.equal(await panel.evaluate('(async ()=>(await chrome.windows.getAll()).length)()'), before.windows, 'Escape keeps browser window');
    assert.equal((await panel.evaluate('openOverlay()')).mode, 'overlay');
    palette = await getPalette();
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 20, y: 20, button: 'left', clickCount: 1 }, site.sessionId);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 20, y: 20, button: 'left', clickCount: 1 }, site.sessionId);
    await panel.until(`(async () => !(await chrome.storage.session.get('amaPalette:${before.tabId}'))['amaPalette:${before.tabId}'])()`, 'outside click dismisses');
    assert.equal(await site.evaluate('document.activeElement.id'), 'page-input');
    await panel.evaluate('openOverlay()');
    await panel.evaluate('openOverlay()');
    palette = await getPalette();
    assert.equal((await send('Target.getTargets')).targetInfos.filter(item => item.type === 'iframe' && item.url.startsWith(`chrome-extension://${id}/palette.html?`)).length, 1, 'reopening replaces rather than stacks overlays');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, palette.sessionId);
    await panel.until(`(async () => !(await chrome.storage.session.get('amaPalette:${before.tabId}'))['amaPalette:${before.tabId}'])()`, 'reopened overlay closes');
    assert.equal(await site.evaluate('document.activeElement.id'), 'page-input', 'repeated opens retain the original focus target');
    await panel.evaluate('openOverlay()');
    palette = await getPalette();
    await palette.evaluate(`document.querySelector('#palette-input').value='> new tab';document.querySelector('#palette-input').dispatchEvent(new Event('input'))`);
    const count = await panel.evaluate('(async ()=>(await chrome.tabs.query({windowId:__overlayWindowId})).length)()');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, palette.sessionId);
    await panel.until(`(async () => (await chrome.tabs.query({windowId:__overlayWindowId})).length===${count+1}
      && !(await chrome.storage.session.get('amaPalette:${before.tabId}'))['amaPalette:${before.tabId}'])()`, 'command runs in parent and removes overlay');
    assert.equal(await panel.evaluate('(async ()=>(await chrome.windows.getAll()).length)()'), before.windows);
    // A web page can embed the public HTML, but cannot obtain browsing data or execute commands.
    await site.evaluate(`(() => {const iframe=document.createElement('iframe');iframe.src='chrome-extension://${id}/palette.html?windowId=${before.windowId}';document.body.append(iframe);})()`);
    let forged;
    for(let i=0;i<60;i++) {
      forged=(await send('Target.getTargets')).targetInfos.find(item=>item.type==='iframe' && item.url===`chrome-extension://${id}/palette.html?windowId=${before.windowId}`);
      if(forged) break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.ok(forged);
    const untrusted = await attach(forged.targetId);
    await untrusted.until('document.querySelector("#palette-error") && !document.querySelector("#palette-error").hidden', 'uninvited iframe denied');
    const rejected = await untrusted.evaluate(`chrome.runtime.sendMessage({type:'READ',windowId:${before.windowId}})`);
    assert.equal(rejected.ok, false, 'background rejects direct forged-frame reads');
    const navigate = await untrusted.evaluate(`chrome.runtime.sendMessage({type:'NEW_TAB',windowId:${before.windowId}})`);
    assert.equal(navigate.ok, false, 'background rejects forged-frame mutations');
    const { targetId: publicPageId } = await send('Target.createTarget', { url: `chrome-extension://${id}/palette.html?windowId=${before.windowId}` });
    const publicPage = await attach(publicPageId);
    await publicPage.until('document.querySelector("#palette-error") && !document.querySelector("#palette-error").hidden', 'uninvited normal tab denied');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, publicPage.sessionId);
    assert.equal(await panel.evaluate('(async ()=>(await chrome.windows.getAll()).length)()'), before.windows, 'Escape on the public page cannot close the normal browser window');
    assert.deepEqual(errors, []);
    console.log(`Native overlay smoke passed (temporary localhost permission): no popup window, iframe focus, shrink/expand, Escape/outside dismissal, original focus restoration, repeated opens, Enter command, unauthorized iframe and normal-tab rejection.\nPreviews: ${output}/palette-overlay-{light,dark}.png`);
  });
} finally { await new Promise(resolve => server.close(resolve)); await rm(staged, {recursive:true, force:true}); }
