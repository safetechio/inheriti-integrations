#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const origin = 'http://127.0.0.1:6110';
const port = 6110;
const hmrPort = 6111;
let ladle;
let electron;
let interrupted = false;

async function assertPortFree(portToCheck) {
  const probe = createServer();
  await new Promise((done, reject) => {
    probe.once('error', reject);
    probe.listen(portToCheck, '127.0.0.1', () => probe.close(done));
  }).catch((error) => {
    throw new Error(`Visual catalog port ${portToCheck} is in use: ${error.message}`);
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((done) => child.once('exit', done)),
    new Promise((done) => setTimeout(done, 3000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

function onSignal() {
  interrupted = true;
  void stop(electron);
  void stop(ladle);
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, onSignal);

try {
  await assertPortFree(port);
  await assertPortFree(hmrPort);
  const cli = resolve(appRoot, 'node_modules/@ladle/react/lib/cli/cli.js');
  ladle = spawn(process.execPath, [cli, 'serve', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: appRoot,
    env: { ...process.env, BROWSER: 'none', INHERITI_VISUAL_CATALOG: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let announced = '';
  let ladleStopped = false;
  let ladleError;
  ladle.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    announced = (announced + chunk.toString()).slice(-4096);
  });
  ladle.once('error', (error) => {
    ladleError = error;
  });
  ladle.once('exit', () => {
    ladleStopped = true;
  });

  const deadline = Date.now() + 90000;
  let ready = false;
  while (Date.now() < deadline && !interrupted) {
    if (ladleError) throw ladleError;
    if (ladleStopped) throw new Error('The visual catalog server stopped before Electron opened.');
    const served = announced.match(/Ladle\.dev served at (https?:\/\/[^\s\u001b]+)/);
    if (served && new URL(served[1]).origin !== origin) {
      throw new Error(`Visual catalog started on an unexpected port: ${served[1]}`);
    }
    if (served) {
      try {
        const response = await fetch(`${origin}/meta.json`, { signal: AbortSignal.timeout(1000) });
        const meta = response.ok ? await response.json() : null;
        if (meta && Object.keys(meta.stories ?? {}).length > 0) {
          ready = true;
          break;
        }
      } catch {
        // Ladle is still compiling the catalog.
      }
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  if (!ready) throw new Error('Visual catalog did not become ready within 90 seconds.');
  if (interrupted) throw new Error('Visual catalog startup was interrupted.');

  const env = { ...process.env, INHERITI_VISUAL_CATALOG: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = [resolve(appRoot, 'testing/visual-catalog/main.cjs')];
  if (process.platform === 'linux') args.push('--disable-setuid-sandbox');
  electron = spawn(require('electron'), args, { cwd: appRoot, env, stdio: 'inherit' });
  if (ladleError || ladleStopped)
    throw ladleError ?? new Error('The visual catalog server stopped.');
  const serverStopped = new Promise((_done, reject) => {
    ladle.once('error', reject);
    ladle.once('exit', () =>
      reject(new Error('The visual catalog server stopped while Electron was open.')),
    );
  });
  const windowClosed = new Promise((done, reject) => {
    electron.once('error', reject);
    electron.once('exit', (code, signal) => done({ code, signal }));
  });
  const exit = await Promise.race([windowClosed, serverStopped]);
  if (!interrupted && exit.code !== 0) {
    throw new Error(`Electron visual catalog exited with ${exit.signal ?? exit.code}.`);
  }
} catch (error) {
  if (!interrupted) {
    console.error(error.message);
    process.exitCode = 1;
  }
} finally {
  await stop(electron);
  await stop(ladle);
  if (interrupted) process.exitCode = 130;
}
