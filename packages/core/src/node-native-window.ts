import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process';
import type { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

function desktopEnvironment(): NodeJS.ProcessEnv {
  if (process.platform !== 'linux' || process.env.XDG_RUNTIME_DIR && (process.env.WAYLAND_DISPLAY || process.env.DISPLAY))
    return process.env;
  const uid = process.getuid?.();
  const runtime = process.env.XDG_RUNTIME_DIR ?? (uid === undefined ? undefined : `/run/user/${uid}`);
  const base: NodeJS.ProcessEnv = { ...process.env, ...(runtime ? { XDG_RUNTIME_DIR: runtime,
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS ?? `unix:path=${runtime}/bus` } : {}) };
  const session = spawnSync('systemctl', ['--user', 'show-environment'], {
    env: base, encoding: 'utf8', timeout: 1_500, maxBuffer: 64_000, stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (session.status !== 0 || !session.stdout) return base;
  const allowed = new Set(['DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS']);
  for (const line of session.stdout.split('\n')) {
    const separator = line.indexOf('=');
    if (separator > 0 && allowed.has(line.slice(0, separator))) base[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return base;
}

/** One disposable OS window for a local create or reveal operation. */
export function createNativeWindowSession(onClose: (reason: 'closed' | 'unavailable') => void) {
  let child: ChildProcessByStdio<Writable, null, null> | undefined;
  let closed = false;
  const ended = (reason: 'closed' | 'unavailable') => {
    if (closed) return;
    closed = true;
    onClose(reason);
  };
  return {
    open(url: string) {
      if (closed) throw new Error('local_window_closed');
      const address = new URL(url);
      if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || !address.port
        || address.username || address.password || address.search || address.hash || !/^\/[a-f0-9]{48}$/.test(address.pathname)) {
        throw new Error('local_window_url_invalid');
      }
      if (!child) {
        const binary = fileURLToPath(new URL(`./native/inheriti-window${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
        child = spawn(binary, [], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true, env: desktopEnvironment() });
        child.once('error', () => ended('unavailable'));
        child.once('exit', (code, signal) => ended(code === 0 && !signal ? 'closed' : 'unavailable'));
        child.stdin.once('error', () => ended('unavailable'));
      }
      child.stdin.write(`${url}\n`);
    },
    close() {
      if (closed) return;
      closed = true;
      child?.stdin.end();
      child?.kill();
    },
    complete() {
      if (closed) return;
      closed = true;
      child?.stdin.end('HOLD\n');
      child?.unref();
    },
  };
}
