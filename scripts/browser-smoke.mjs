import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(join(tmpdir(), 'ama-browser-'));
let browser;
let output = '';
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const commands = new Map();
const errors = [];
let sequence = 0;
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { commands.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    commands.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
    browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}

try {
  const harness = join(temporary, 'panel-test.html');
  const html = (await readFile(join(root, 'extension/panel.html'), 'utf8'))
    .replace('href="panel.css"', `href="${pathToFileURL(join(root, 'extension/panel.css'))}"`)
    .replace('src="panel.js"', `src="${pathToFileURL(join(root, 'tests/browser-fixture.mjs'))}"`);
  await writeFile(harness, html);
  browser = spawn(process.env.CHROME_PATH || 'google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--allow-file-access-from-files', '--remote-debugging-pipe',
    `--user-data-dir=${join(temporary, 'profile')}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  browser.stderr.on('data', chunk => { output += chunk.toString(); });
  const rejectPending = error => { for (const command of commands.values()) command.reject(error); commands.clear(); };
  browser.on('error', rejectPending);
  browser.stdio[3].on('error', rejectPending);
  browser.once('exit', code => rejectPending(new Error(`Chrome exited (${code}): ${output.slice(-2000)}`)));
  let buffer = '';
  browser.stdio[4].on('data', chunk => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf('\0')) !== -1) {
      const raw = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!raw) continue;
      const message = JSON.parse(raw);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text + ': ' + (message.params.exceptionDetails.exception?.description || ''));
      const command = commands.get(message.id);
      if (!command) continue;
      commands.delete(message.id);
      if (message.error) command.reject(new Error(message.error.message)); else command.resolve(message.result);
    }
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send('Page.navigate', { url: pathToFileURL(harness).href }, sessionId);
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Page evaluation failed');
    return result.result.value;
  };
  const until = async (expression, label) => {
    for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await pause(50); }
    throw new Error(`Timed out: ${label}; page errors: ${errors.join('; ')}`);
  };
  await until('document.querySelectorAll(".workspace-chip").length === 1', 'workspace renders');
  assert.equal(await evaluate('Boolean(window.pwned || document.querySelector("#resources img"))'), false);
  const uiFailures = [];
  const check = async (name, task) => {
    try { await task(); console.log(`UI regression passed: ${name}`); }
    catch (error) { uiFailures.push(`${name}: ${error.message}`); console.error(`UI regression failed: ${name}: ${error.message}`); }
  };
  await check('cold panel focuses search even when the shortcut message arrived too early', async () => {
    assert.equal(await evaluate('document.activeElement.id'), 'search');
  });
  await check('focus messages only affect the intended window', async () => {
    await evaluate('document.querySelector("#new-workspace").focus(); chrome.runtime.onMessage.emit({type:"FOCUS_SEARCH",windowId:2})');
    assert.equal(await evaluate('document.activeElement.id'), 'new-workspace');
    await evaluate('chrome.runtime.onMessage.emit({type:"FOCUS_SEARCH",windowId:1})');
    assert.equal(await evaluate('document.activeElement.id'), 'search');
  });
  await check('background errors display without reopening the panel', async () => {
    await evaluate('chrome.storage.session.set({amaError:"background test failure"})');
    await until('!document.querySelector("#error").hidden && document.querySelector("#error").textContent.includes("background test failure")', 'live background error');
  });
  await check('identical error messages can be displayed again after a successful action', async () => {
    await evaluate('chrome.storage.session.set({amaError:{id:"first",message:"repeat test failure"}})');
    await until('document.querySelector("#error").textContent.includes("repeat test failure")', 'first error occurrence');
    await evaluate('document.querySelector(".workspace-chip").click()');
    await until('document.querySelector("#error").hidden', 'successful action clears visible error');
    await evaluate('chrome.storage.session.set({amaError:{id:"second",message:"repeat test failure"}})');
    await until('!document.querySelector("#error").hidden && document.querySelector("#error").textContent.includes("repeat test failure")', 'repeated error occurrence');
  });
  await check('collapsed folders survive tab-driven refreshes', async () => {
    await evaluate('document.querySelector("#resources summary").click(); window.__oldFolder=document.querySelector("#resources details"); chrome.tabs.onUpdated.emit(1,{title:"updated"})');
    await until('document.querySelector("#resources details") !== window.__oldFolder', 'folder rerender');
    assert.equal(await evaluate('document.querySelector("#resources details").open'), false);
  });
  await check('dragging one tab onto another creates a split and Unsplit retains both tabs', async () => {
    assert.equal(await evaluate('document.querySelectorAll("#unassigned .row")[1].draggable'), true);
    await evaluate(`(() => {
      const [target, source] = document.querySelectorAll('#unassigned .row');
      const dataTransfer = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', {bubbles:true, dataTransfer}));
      target.dispatchEvent(new DragEvent('dragover', {bubbles:true, cancelable:true, dataTransfer}));
      target.dispatchEvent(new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer}));
      source.dispatchEvent(new DragEvent('dragend', {bubbles:true, dataTransfer}));
    })()`);
    await until('window.__ama.tabs.get(1).splitViewId >= 0 && document.querySelector("[data-action=unsplit]")', 'drag-to-split');
    assert.equal(await evaluate('window.__ama.tabs.get(1).splitViewId === window.__ama.tabs.get(2).splitViewId'), true);
    await evaluate('document.querySelector("[data-action=unsplit]").click()');
    await until('window.__ama.tabs.get(1).splitViewId === -1 && window.__ama.tabs.get(2).splitViewId === -1', 'unsplit');
    assert.equal(await evaluate('window.__ama.tabs.size'), 2);
  });
  await evaluate('chrome.tabs.update(1,{active:true})');
  await evaluate('document.querySelector("#new-workspace").click(); document.querySelector("#workspace-form [name=name]").value="研究"; document.querySelector("#workspace-form").requestSubmit()');
  await until('document.querySelectorAll(".workspace-chip").length === 2', 'workspace creation');
  await check('new workspaces become the shared active workspace for the command palette', async () => {
    assert.equal(await evaluate('window.__ama.session.amaSession?.active.find(item=>item.windowId===1)?.workspaceId'),
      await evaluate('window.__ama.local.ama.workspaces[1].id'));
  });
  await evaluate('document.querySelector("#save-current").click()');
  await until('document.querySelector("#resource-dialog").open', 'resource dialog');
  await evaluate('document.querySelector("#resource-form [name=folder]").value="参考资料"; document.querySelector("#resource-form").requestSubmit()');
  await until('document.querySelector("#resources").textContent.includes("Chrome extension")', 'saved link');
  await check('folder expansion is independent per workspace and survives switching', async () => {
    assert.equal(await evaluate('document.querySelector("#resources details").open'), true);
    await evaluate('document.querySelectorAll(".workspace-chip")[0].click()');
    await until('document.querySelector("#workspace-title").textContent === "日常"', 'switch to home');
    assert.equal(await evaluate('document.querySelector("#resources details").open'), false);
  });
  await evaluate('document.querySelectorAll(".workspace-chip")[1].click()');
  await until('document.querySelector("#workspace-title").textContent === "研究"', 'switch back to research');
  await check('workspace changes from the palette are reflected in an open sidebar', async () => {
    await evaluate('chrome.runtime.sendMessage({type:"WORKSPACE_SWITCH",workspaceId:"home",windowId:1})');
    await until('document.querySelector("#workspace-title").textContent === "日常"', 'external workspace switch');
  });
  await evaluate('document.querySelectorAll(".workspace-chip")[1].click()');
  await until('document.querySelector("#workspace-title").textContent === "研究"', 'return to research');
  await evaluate('document.querySelector("#unassigned [data-action=move]").click()');
  await until('document.querySelectorAll("#tabs .row").length === 1', 'tab moves into workspace');
  await evaluate('document.querySelector("#save-snapshot").click()');
  await until('document.querySelector("#snapshot").textContent.includes("恢复")', 'snapshot save');
  await evaluate('document.querySelector("#search").value="chrome"; document.querySelector("#search").dispatchEvent(new Event("input"))');
  await until('document.querySelectorAll("#search-results .row").length >= 2', 'search tabs and saved links');
  await evaluate('document.querySelector("#search").value=""; document.querySelector("#search").dispatchEvent(new Event("input")); document.querySelector("[data-view=settings]").click(); document.querySelector("#auto-archive").checked=true; document.querySelector("#settings-form").requestSubmit()');
  await until('window.__ama.local.ama.settings.autoArchive === true', 'settings save');
  assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
  await evaluate('document.querySelector("[data-view=workspace]").click()');
  await check('an open resource dialog keeps its original workspace when the palette switches workspaces', async () => {
    await evaluate('document.querySelector("#new-resource").click(); chrome.runtime.sendMessage({type:"WORKSPACE_SWITCH",workspaceId:"home",windowId:1})');
    await until('document.querySelector("#workspace-title").textContent === "日常"', 'switch while resource dialog is open');
    await evaluate('document.querySelector("#resource-form [name=title]").value="Dialog context"; document.querySelector("#resource-form [name=url]").value="https://dialog-context.example/"; document.querySelector("#resource-form").requestSubmit()');
    await until('!document.querySelector("#resource-dialog").open', 'resource dialog submitted');
    assert.equal(await evaluate('window.__ama.local.ama.workspaces[1].resources.some(item=>item.url==="https://dialog-context.example/")'), true);
    assert.equal(await evaluate('window.__ama.local.ama.workspaces[0].resources.some(item=>item.url==="https://dialog-context.example/")'), false);
  });
  await check('workspace deletion confirmation and mutation refer to the dialog workspace', async () => {
    await evaluate('document.querySelectorAll(".workspace-chip")[1].click()');
    await until('document.querySelector("#workspace-title").textContent === "研究"', 'select editor workspace');
    await evaluate('document.querySelector("#edit-workspace").click(); chrome.runtime.sendMessage({type:"WORKSPACE_SWITCH",workspaceId:"home",windowId:1})');
    await until('document.querySelector("#workspace-title").textContent === "日常"', 'switch while editor open');
    await evaluate('window.confirm=message=>{window.__confirmation=message;return false}; document.querySelector("#delete-workspace").click()');
    await until('typeof window.__confirmation === "string"', 'delete confirmation');
    assert.equal(await evaluate('window.__confirmation.includes("研究") && !window.__confirmation.includes("日常")'), true);
    await evaluate('window.confirm=()=>true; document.querySelector("#delete-workspace").click()');
    await until('window.__ama.local.ama.workspaces.length === 1', 'delete original dialog workspace');
    assert.equal(await evaluate('window.__ama.local.ama.workspaces[0].id'), 'home');
  });
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
  const screenshotPath = '/tmp/ama-panel-smoke.png';
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  const paletteHarness = join(temporary, 'palette-test.html');
  const paletteHtml = (await readFile(join(root, 'extension/palette.html'), 'utf8'))
    .replace('href="palette.css"', `href="${pathToFileURL(join(root, 'extension/palette.css'))}"`)
    .replace('src="palette.js"', `src="${pathToFileURL(join(root, 'tests/browser-fixture.mjs'))}"`);
  await writeFile(paletteHarness, paletteHtml);
  await send('Emulation.setDeviceMetricsOverride', { width: 680, height: 520, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send('Page.navigate', { url: `${pathToFileURL(paletteHarness).href}?test=palette&windowId=1` }, sessionId);
  await until('document.querySelectorAll("#palette-list [role=option]").length > 0', 'palette ready');
  await check('palette keyboard navigation selects a tab, while IME Enter does not execute', async () => {
    assert.equal(await evaluate('document.activeElement.id'), 'palette-input');
    await evaluate('document.querySelector("#palette-input").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",isComposing:true,bubbles:true}))');
    assert.equal(await evaluate('window.__closedWindow ?? null'), null);
    await evaluate('document.querySelector("#palette-input").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}))');
    assert.equal(await evaluate('document.querySelector("#palette-input").getAttribute("aria-activedescendant")'), 'palette-option-1');
    await evaluate('document.querySelector("#palette-input").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))');
    await until('window.__closedWindow === 50', 'successful command closes palette');
    assert.equal(await evaluate('window.__ama.tabs.get(2).active'), true);
    assert.equal(await evaluate('window.__ama.control.focusedWindow'), 1);
  });
  await check('palette failures stay visible and leave the palette open', async () => {
    await evaluate('window.__closedWindow=undefined; window.__ama.control.failSave=true; document.querySelector("#palette-input").value="> save current"; document.querySelector("#palette-input").dispatchEvent(new Event("input")); document.querySelector("#palette-input").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))');
    await until('!document.querySelector("#palette-error").hidden && document.querySelector("#palette-error").textContent.includes("Storage full")', 'command error');
    assert.equal(await evaluate('window.__closedWindow ?? null'), null);
    await evaluate('window.__ama.control.failSave=false');
  });
  await check('palette renders malicious saved titles as text and opens typed URLs', async () => {
    await evaluate('document.querySelector("#palette-input").value="<img"; document.querySelector("#palette-input").dispatchEvent(new Event("input"))');
    assert.equal(await evaluate('Boolean(window.pwned || document.querySelector("#palette-list img"))'), false);
    await evaluate('document.querySelector("#palette-input").value="open-this.example/docs"; document.querySelector("#palette-input").dispatchEvent(new Event("input")); document.querySelector("#palette-input").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))');
    await until('window.__closedWindow === 50', 'typed URL closes palette');
    assert.equal(await evaluate('[...window.__ama.tabs.values()].some(tab=>tab.url==="https://open-this.example/docs" && tab.windowId===1)'), true);
  });
  await check('Escape dismisses the palette without performing another action', async () => {
    await evaluate('window.__closedWindow=undefined; document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await until('window.__closedWindow === 50', 'Escape closes palette');
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(uiFailures, [], 'UI regression failures');
  console.log(`Browser smoke passed: create workspace, save link, move tab, snapshot, search, settings, XSS text handling, 360px layout.\nScreenshot: ${screenshotPath}\nChrome APIs use the test adapter; this is not a live-profile installation test.`);
} finally {
  if (browser && browser.exitCode === null) {
    browser.kill('SIGTERM');
    await Promise.race([new Promise(resolve => browser.once('exit', resolve)), pause(3000)]);
    if (browser.exitCode === null) browser.kill('SIGKILL');
  }
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
