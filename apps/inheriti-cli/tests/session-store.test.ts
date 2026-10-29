import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { build } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { FileOperatorSessionStore, SessionStoreUnreadable, defaultSessionPath } from '../src/session-store.js';
import type { OperatorSession } from '@safetech/inheriti-elements-core';
import { logout } from '../src/commands/logout.js';
import type { CliContext } from '../src/session.js';
import type { Terminal } from '../src/output.js';

const session = {
  accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer' as const, expiresAt: Date.now() + 60_000,
  principal: {
    issuer: 'http://127.0.0.1:4564/realms/elements', audience: 'inheriti-elements-api',
    authorizedParty: 'elements-test-cli-device', environment: 'TEST' as const,
    subject: 'operator-1', sessionId: 'session-1', tokenId: 'token-1', scopes: ['plan:list'],
  },
};

async function storeInTemporaryDirectory(): Promise<{ store: FileOperatorSessionStore; path: string }> {
  const path = resolve(await mkdtemp(resolve(tmpdir(), 'elements-cli-')), 'session.json');
  return { store: new FileOperatorSessionStore(path), path };
}

describe('FileOperatorSessionStore', () => {
  it('invalidates saved provider credentials in Business mode', async () => {
    const { path } = await storeInTemporaryDirectory();
    const provider = new FileOperatorSessionStore(path);
    await provider.save(session);
    const business = new FileOperatorSessionStore(path, undefined, true);
    await expect(business.load()).resolves.toBeUndefined();
    await expect(readFile(path)).rejects.toBeTruthy();
  });

  it('serializes independent clients through the refresh operation and writes a whole session', async () => {
    const { path } = await storeInTemporaryDirectory();
    const first = new FileOperatorSessionStore(path, undefined, true);
    const second = new FileOperatorSessionStore(path, undefined, true);
    const business = { ...session, kind: 'business', familyId: 'family-1', sessionExpiresAt: Date.now() + 3_600_000 } as OperatorSession;
    await first.save(business);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const firstOperation = first.withExclusiveAccess(async () => {
      await held;
      await first.save({ ...business, refreshToken: 'rotated' });
    });
    let entered = false;
    const secondOperation = second.withExclusiveAccess(async () => {
      entered = true;
      return (await second.load())?.refreshToken;
    });
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(entered).toBe(false);
    release();
    await firstOperation;
    await expect(secondOperation).resolves.toBe('rotated');
    expect(await readFile(path, 'utf8')).toContain('rotated');
  });

  it('recovers a crashed process lock while two other processes contend', async () => {
    const home = await mkdtemp(resolve(tmpdir(), 'elements-cli-lock-'));
    const modulePath = resolve(home, 'session-store.mjs');
    const path = resolve(home, 'session.json');
    const eventsPath = resolve(home, 'events.txt');
    await build({ entryPoints: [resolve(import.meta.dirname, '../src/session-store.ts')], outfile: modulePath,
      bundle: true, platform: 'node', format: 'esm', external: ['@napi-rs/keyring'] });
    const hold = `import { pathToFileURL } from 'node:url';
      const { FileOperatorSessionStore } = await import(pathToFileURL(process.argv[1]).href);
      await new FileOperatorSessionStore(process.argv[2]).withExclusiveAccess(async () => {
        process.stdout.write('ready\\n'); await new Promise(() => undefined);
      });`;
    const waiter = `import { pathToFileURL } from 'node:url'; import { appendFile } from 'node:fs/promises';
      const { FileOperatorSessionStore } = await import(pathToFileURL(process.argv[1]).href);
      await new FileOperatorSessionStore(process.argv[2]).withExclusiveAccess(async () => {
        await appendFile(process.argv[3], 'start\\n');
        await new Promise(resolve => setTimeout(resolve, 150));
        await appendFile(process.argv[3], 'end\\n');
      });`;
    const recover = `import { writeFile } from 'node:fs/promises';
      await writeFile(process.argv[1] + '.lock/recovery.1', String(process.pid), { flag: 'wx', mode: 0o600 });
      process.stdout.write('ready\\n'); await new Promise(() => undefined);`;
    const crashed = spawn(process.execPath, ['--input-type=module', '-e', hold, modulePath, path], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await new Promise<void>((resolve, reject) => {
        crashed.stdout.once('data', () => resolve());
        crashed.once('error', reject);
      });
      crashed.kill('SIGKILL');
      await once(crashed, 'exit');
      const claimant = spawn(process.execPath, ['--input-type=module', '-e', recover, path], { stdio: ['ignore', 'pipe', 'pipe'] });
      await new Promise<void>((resolve, reject) => {
        claimant.stdout.once('data', () => resolve());
        claimant.once('error', reject);
      });
      claimant.kill('SIGKILL');
      await once(claimant, 'exit');
      const run = () => new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', waiter, modulePath, path, eventsPath]);
        child.once('error', reject);
        child.once('exit', code => code === 0 ? resolve() : reject(new Error(`waiter_exit_${code}`)));
      });
      await Promise.all([run(), run()]);
      expect((await readFile(eventsPath, 'utf8')).trim().split('\n')).toEqual(['start', 'end', 'start', 'end']);
    } finally {
      crashed.kill('SIGKILL');
      await rm(home, { recursive: true, force: true });
    }
  }, 15_000);

  it('publishes exactly one complete recovery claimant under contention', async () => {
    const { path } = await storeInTemporaryDirectory();
    const lockPath = `${path}.lock`;
    await mkdir(lockPath);
    await writeFile(`${lockPath}/owner`, '99999999');
    const store = new FileOperatorSessionStore(path) as any;
    const claims = await Promise.all(Array.from({ length: 20 }, () => store.claimRecovery(lockPath)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await readFile(`${lockPath}/recovery.1`, 'utf8')).toBe(String(process.pid));
    await rm(lockPath, { recursive: true, force: true });
  });

  it('does not clear a newer login after logout releases its exclusive session operation', async () => {
    const { path } = await storeInTemporaryDirectory();
    const store = new FileOperatorSessionStore(path, undefined, true);
    const business = { ...session, kind: 'business', familyId: 'family-1', sessionExpiresAt: Date.now() + 3_600_000 } as OperatorSession;
    await store.save(business);
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const clear = () => store.withExclusiveAccess(async () => { entered(); await pending; await store.clear(); });
    const terminal = { write: vi.fn(), writeError: vi.fn() } as unknown as Terminal;
    const signingOut = logout({ core: { auth: { clear } }, sessions: store } as CliContext, terminal);
    await started;
    const newer = store.withExclusiveAccess(() => store.save({ ...business, refreshToken: 'new-login' }));
    release();
    await signingOut;
    await newer;
    expect((await store.load())?.refreshToken).toBe('new-login');
  });

  it('reports lock acquisition failure without claiming sign-out', async () => {
    const error = new SessionStoreUnreadable('session_lock_timed_out');
    const { store } = await storeInTemporaryDirectory();
    const terminal = { write: vi.fn(), writeError: vi.fn() } as unknown as Terminal;
    await expect(logout({ core: { auth: { clear: async () => { throw error; } } }, sessions: store } as unknown as CliContext, terminal)).rejects.toBe(error);
    expect(terminal.write).not.toHaveBeenCalled();
    expect(terminal.writeError).not.toHaveBeenCalled();
  });

  it('warns only when local cleanup completed after a remote revocation failure', async () => {
    const { path } = await storeInTemporaryDirectory();
    const store = new FileOperatorSessionStore(path);
    await store.save(session);
    const terminal = { write: vi.fn(), writeError: vi.fn() } as unknown as Terminal;
    const clear = async () => {
      await store.clear();
      throw new Error('remote_revocation_failed');
    };
    await expect(logout({ core: { auth: { clear } }, sessions: store } as unknown as CliContext, terminal)).resolves.toBe(0);
    expect(terminal.writeError).toHaveBeenCalledOnce();
    expect(await store.load()).toBeUndefined();
  });

  it('propagates a local cleanup failure instead of reporting sign-out', async () => {
    const { path } = await storeInTemporaryDirectory();
    const store = new FileOperatorSessionStore(path, { clear: async () => { throw new Error('local_clear_failed'); } });
    const terminal = { write: vi.fn(), writeError: vi.fn() } as unknown as Terminal;
    const clear = () => store.clear();
    await expect(logout({ core: { auth: { clear } }, sessions: store } as CliContext, terminal)).rejects.toThrow('local_clear_failed');
    expect(terminal.write).not.toHaveBeenCalled();
    expect(terminal.writeError).not.toHaveBeenCalled();
  });

  it('preserves keys during token refresh and clears them when the login changes or ends', async () => {
    const { path } = await storeInTemporaryDirectory();
    const keys = { clear: vi.fn().mockResolvedValue(undefined) };
    const store = new FileOperatorSessionStore(path, keys);
    await store.save(session);
    await store.save(Object.assign({}, session, { accessToken: 'refreshed' }));
    expect(keys.clear).not.toHaveBeenCalled();
    await store.save(Object.assign({}, session, { principal: Object.assign({}, session.principal, { sessionId: 'new-login' }) }));
    expect(keys.clear).toHaveBeenCalledOnce();
    await store.clear();
    expect(keys.clear).toHaveBeenCalledTimes(2);
  });

  it('removes the login even when protected-key deletion fails', async () => {
    const { path } = await storeInTemporaryDirectory();
    const keys = { clear: vi.fn().mockRejectedValue(new Error('locked')) };
    const store = new FileOperatorSessionStore(path, keys);
    await store.save(session);
    await expect(store.clear()).rejects.toThrow('locked');
    await expect(readFile(path)).rejects.toBeTruthy();
  });
  it('is absent before the first login rather than failing', async () => {
    const { store } = await storeInTemporaryDirectory();
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('reports an unreadable session instead of treating it as signed out', async () => {
    const { path } = await storeInTemporaryDirectory();
    await expect(new FileOperatorSessionStore(resolve(path, '..')).load())
      .rejects.toMatchObject({ code: 'session_file_unreadable' });
  });

  it('round-trips a session and writes it owner-only', async () => {
    const { store, path } = await storeInTemporaryDirectory();
    await store.save(session);
    await expect(store.load()).resolves.toMatchObject({ principal: { subject: 'operator-1' } });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('clears a corrupt session and fails closed instead of returning a partial one', async () => {
    const { store, path } = await storeInTemporaryDirectory();
    await store.save(session);
    await writeFile(path, '{ not json', { mode: 0o600 });
    await expect(store.load()).rejects.toBeInstanceOf(SessionStoreUnreadable);
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('refuses and clears a session another user could read', async () => {
    const { store, path } = await storeInTemporaryDirectory();
    await store.save(session);
    await chmod(path, 0o644);
    await expect(store.load()).rejects.toMatchObject({ code: 'session_permissions_widened' });
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('does not mistake Windows mode bits for POSIX owner permissions', async () => {
    const { store, path } = await storeInTemporaryDirectory();
    await store.save(session);
    await chmod(path, 0o644);
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
    try {
      Object.defineProperty(process, 'platform', { ...descriptor, value: 'win32' });
      await expect(store.load()).resolves.toMatchObject({ principal: { subject: 'operator-1' } });
      await expect(readFile(path)).resolves.toBeTruthy();
    } finally {
      Object.defineProperty(process, 'platform', descriptor);
    }
  });

  it('leaves nothing behind on logout', async () => {
    const { store, path } = await storeInTemporaryDirectory();
    await store.save(session);
    await store.clear();
    await expect(readFile(path, 'utf8')).rejects.toBeTruthy();
    await expect(store.clear()).resolves.toBeUndefined();
  });

  it('uses Inheriti state while preserving an existing login in the previous location', async () => {
    const home = await mkdtemp(resolve(tmpdir(), 'inheriti-state-'));
    const current = resolve(home, 'inheriti', 'session.json');
    const legacy = resolve(home, 'inheriti-elements', 'session.json');
    try {
      expect(defaultSessionPath({ XDG_STATE_HOME: home })).toBe(current);
      await mkdir(resolve(home, 'inheriti-elements'));
      await writeFile(legacy, '{}');
      expect(defaultSessionPath({ XDG_STATE_HOME: home })).toBe(legacy);
      await mkdir(resolve(home, 'inheriti'));
      await writeFile(current, '{}');
      expect(defaultSessionPath({ XDG_STATE_HOME: home })).toBe(current);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
    expect(defaultSessionPath({ INHERITI_ELEMENTS_STATE_DIR: '/tmp/elements' }))
      .toBe('/tmp/elements/session.json');
  });
});
