import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const pause = delay => new Promise(resolve => setTimeout(resolve, delay));

export async function withChrome(task) {
  const temporary = await mkdtemp(join(tmpdir(), 'ama-native-'));
  const browser = spawn(process.env.CHROME_PATH || 'google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--enable-unsafe-extension-debugging', '--remote-debugging-pipe',
    `--user-data-dir=${temporary}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  const errors = [];
  let sequence = 0;
  let stderr = '';
  let buffer = '';
  const rejectAll = error => { for (const entry of pending.values()) entry.reject(error); pending.clear(); };
  browser.stderr.on('data', data => { stderr += data.toString(); });
  browser.on('error', rejectAll);
  browser.stdio[3].on('error', rejectAll);
  browser.once('exit', code => rejectAll(new Error(`Chrome exited ${code}: ${stderr.slice(-2000)}`)));
  browser.stdio[4].on('data', data => {
    buffer += data.toString();
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const raw = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!raw) continue;
      const message = JSON.parse(raw);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      const entry = pending.get(message.id);
      if (!entry) continue;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
  const attach = async targetId => {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId);
    const evaluate = async expression => {
      const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      return response.result.value;
    };
    const until = async (expression, label) => {
      for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(50); }
      throw new Error(`Timed out: ${label}`);
    };
    return { sessionId, evaluate, until };
  };
  try { return await task({ send, attach, errors }); }
  finally {
    if (browser.exitCode === null) {
      browser.kill('SIGTERM');
      await Promise.race([new Promise(resolve => browser.once('exit', resolve)), pause(3000)]);
      if (browser.exitCode === null) browser.kill('SIGKILL');
    }
    await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}
