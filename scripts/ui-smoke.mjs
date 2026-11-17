import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { withChrome } from '../tests/helpers/chrome-driver.mjs';

// Local fixture sites, not a favicon proxy. The actual extension cache supplies every image.
const sites = [
  ['Mail', '#d94f45', 'M'], ['Calendar', '#3978db', '17'], ['Music', '#22966d', '♫'], ['Notes', '#3a3a3a', 'N'],
  ['Design Library', '#9852d2', 'D'], ['Chrome Developers', '#34884f', 'C'], ['GitHub · ama', '#34343c', 'G'],
  ['Interface inspiration', '#c84a83', 'I'], ['A very long research title that should remain readable without action buttons taking its space', '#3978db', 'R'],
];
const server = createServer((request, response) => {
  const index = Number(new URL(request.url, 'http://fixture').pathname.split('/')[1]) || 0;
  const [title, color, letter] = sites[index] || sites[0];
  if (request.url.endsWith('icon.svg')) {
    response.writeHead(200, { 'content-type': 'image/svg+xml' });
    response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="6" fill="${color}"/><text x="16" y="23" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="20" fill="white">${letter}</text></svg>`);
  } else {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><head><title>${title}</title><link rel="icon" type="image/svg+xml" href="/${index}/icon.svg"></head><body>${title}</body></html>`);
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const output = resolve(import.meta.dirname, '../dist/previews');
await mkdir(output, { recursive: true });
try {
  await withChrome(async ({ send, attach, errors }) => {
    const { id } = await send('Extensions.loadUnpacked', { path: resolve(import.meta.dirname, '../extension') });
    const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${id}/panel.html` });
    const panel = await attach(targetId);
    await panel.until('document.querySelectorAll(".workspace-chip").length === 1', 'panel ready');
    const tabIds = [];
    for (let index = 0; index < sites.length; index++) {
      const { targetId: siteId } = await send('Target.createTarget', { url: `${base}/${index}/` });
      const site = await attach(siteId);
      await site.until(`location.href.startsWith(${JSON.stringify(base)}) && document.readyState === 'complete'`, 'fixture website ready', 30000);
      await panel.until(`(async () => (await chrome.tabs.query({})).some(t=>t.url===${JSON.stringify(`${base}/${index}/`)} && t.favIconUrl?.endsWith('icon.svg')))()`, 'Chrome discovers site icon');
      tabIds.push(await panel.evaluate(`(async () => (await chrome.tabs.query({})).find(t=>t.url===${JSON.stringify(`${base}/${index}/`)}).id)()`));
    }
    await panel.evaluate(`(async () => {
      const parent=(await chrome.windows.getCurrent()).id;
      globalThis.uiRequest=async message=>{const r=await chrome.runtime.sendMessage({...message,windowId:parent});if(!r.ok)throw new Error(r.error);return r.data;};
      await uiRequest({type:'WORKSPACE_RENAME',workspaceId:'home',name:'日常',color:'purple'});
      await uiRequest({type:'WORKSPACE_CREATE',name:'工作',color:'blue'});
      await uiRequest({type:'WORKSPACE_CREATE',name:'灵感',color:'pink'});
      for(const tabId of ${JSON.stringify(tabIds.slice(0, 4))}) await chrome.tabs.update(tabId,{pinned:true});
      for(const index of [4,5,6]) await uiRequest({type:'RESOURCE_ADD',workspaceId:'home',title:${JSON.stringify(sites)}[index][0],url:${JSON.stringify(base)}+'/'+index+'/',folder:index===4?'':'开发参考'});
      for(const tabId of ${JSON.stringify(tabIds.slice(4))}) await uiRequest({type:'TAB_MOVE',workspaceId:'home',tabId});
      await uiRequest({type:'WORKSPACE_SWITCH',workspaceId:'home'});
      await chrome.tabs.update(${tabIds[7]},{active:true});
    })()`);
    await panel.until('document.querySelectorAll("#favorites .favorite").length === 4 && document.querySelectorAll("#tabs .row").length === 5', 'populated sidebar');
    await panel.until('document.querySelectorAll(".has-favicon").length >= 12', 'cached favicons render');
    // A default Chrome globe also loads successfully: inspect a known red pixel to prove this is the site's icon.
    const pixel = await panel.evaluate(`(() => {
      const img=document.querySelector('#favorites img');
      const canvas=document.createElement('canvas');canvas.width=canvas.height=32;
      const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,32,32);
      return [...ctx.getImageData(16,3,1,1).data];
    })()`);
    assert.ok(pixel[0] > 150 && pixel[1] < 130 && pixel[2] < 130 && pixel[3] > 200, `real red favicon pixel: ${pixel}`);
    assert.equal(await panel.evaluate('document.querySelectorAll("#unassigned [data-tab-id]").length'), 2, 'pinned tabs are only in the favorites grid');
    await panel.evaluate(`document.querySelector('#favorites button').click()`);
    await panel.until(`(async ()=>(await chrome.tabs.get(${tabIds[0]})).active)()`, 'favorite click focuses its actual tab');
    await panel.evaluate(`chrome.tabs.update(${tabIds[7]},{active:true})`);
    await panel.until(`document.querySelector('#tabs [data-tab-id="${tabIds[7]}"]').classList.contains('active')`, 'active highlight updates');
    const screenshot = async name => {
      await send('Page.bringToFront', {}, panel.sessionId);
      const capture=await send('Page.captureScreenshot',{format:'png'},panel.sessionId);
      await writeFile(`${output}/${name}.png`,Buffer.from(capture.data,'base64'));
    };
    await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 2, mobile: false }, panel.sessionId);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, panel.sessionId);
    await panel.evaluate('document.activeElement.blur()');
    await screenshot('sidebar-light');
    assert.equal(await panel.evaluate('getComputedStyle(document.querySelector("#tabs .row-actions")).visibility'), 'hidden');
    await panel.evaluate('document.querySelector("#tabs .row-content").focus()');
    assert.equal(await panel.evaluate('getComputedStyle(document.querySelector("#tabs .row-actions")).visibility'), 'visible', 'actions accessible on keyboard focus');
    await screenshot('sidebar-actions');
    await panel.evaluate('document.activeElement.blur()');
    for (const width of [280, 320, 360]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: false }, panel.sessionId);
      assert.equal(await panel.evaluate('document.documentElement.scrollWidth > innerWidth'), false, `no horizontal overflow at ${width}px`);
      const box = await panel.evaluate('document.querySelector(".workspace-dock").getBoundingClientRect().toJSON()');
      assert.equal(box.bottom, 800, 'workspace dock stays at the bottom');
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 280, height: 800, deviceScaleFactor: 2, mobile: false }, panel.sessionId);
    await screenshot('sidebar-narrow');
    await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 2, mobile: false }, panel.sessionId);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, panel.sessionId);
    await screenshot('sidebar-dark');
    // Failed requests must restore the local fallback rather than expose a broken-image glyph.
    await panel.evaluate(`(() => {const img=document.querySelector('#favorites img');img.src=chrome.runtime.getURL('/missing-icon.png');})()`);
    await panel.until('document.querySelector("#favorites img").hidden && !document.querySelector("#favorites .site-icon").classList.contains("has-favicon")', 'failed icon falls back');
    await panel.evaluate('document.querySelectorAll(".workspace-chip")[1].click()');
    await panel.until('document.documentElement.dataset.spaceColor === "blue"', 'workspace theme switches');
    await panel.evaluate('document.querySelectorAll(".workspace-chip")[0].click()');
    await panel.until('document.documentElement.dataset.spaceColor === "purple"', 'workspace restores');
    await panel.evaluate(`(async () => {
      for (let i=0;i<10;i++) await uiRequest({type:'WORKSPACE_CREATE',name:'项目 '+i,color:'green'});
    })()`);
    await panel.until('document.querySelectorAll(".workspace-chip").length === 13', 'many spaces render');
    await panel.evaluate('[...document.querySelectorAll(".workspace-chip")].at(-1).focus()');
    assert.equal(await panel.evaluate('document.querySelector("#workspaces").scrollLeft > 0'), true, 'keyboard focus reveals spaces outside the visible dock');
    assert.equal(await panel.evaluate('document.documentElement.scrollWidth > innerWidth'), false, 'overflowing spaces stay inside the dock');
    await screenshot('sidebar-overflow');
    await panel.evaluate('document.querySelector("#new-tab").click()');
    let targets;
    for(let i=0;i<60;i++) {
      targets=(await send('Target.getTargets')).targetInfos;
      if(targets.some(t=>t.url.includes('/palette.html?'))) break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    const popup=targets.find(t=>t.url.startsWith(`chrome-extension://${id}/palette.html?`));
    assert.ok(popup, 'new-tab entry opens the real command palette');
    const palette=await attach(popup.targetId);
    await palette.until('document.querySelectorAll(".has-favicon").length >= 12','palette favicons');
    assert.equal(await palette.evaluate('document.activeElement.id'),'palette-input');
    await send('Emulation.setDeviceMetricsOverride',{width:680,height:520,deviceScaleFactor:2,mobile:false},palette.sessionId);
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]},palette.sessionId);
    const capture=await send('Page.captureScreenshot',{format:'png'},palette.sessionId);
    await writeFile(`${output}/palette-light.png`,Buffer.from(capture.data,'base64'));
    assert.deepEqual(errors,[]);
    console.log(`UI native smoke passed: cached site pixel, pinned-tab focus, icon failure fallback, palette icons, workspace tint, keyboard actions, 280/320/360px layout.\nPreviews: ${output} (local fixture sites).`);
  });
} finally { await new Promise(resolve=>server.close(resolve)); }
