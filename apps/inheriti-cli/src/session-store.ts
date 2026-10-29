import { chmod, link, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { OperatorSession, OperatorSessionStore } from '@safetech/inheriti-elements-core';
import { sessionIdentity } from './key-vault.js';

export class SessionStoreUnreadable extends Error {
  constructor(readonly code: string) { super(code); this.name = 'SessionStoreUnreadable'; }
}

let temporaryFileSequence = 0;

export function defaultSessionPath(environmentVariables: Readonly<Record<string, string | undefined>>): string {
  if (environmentVariables.INHERITI_ELEMENTS_STATE_DIR) return resolve(environmentVariables.INHERITI_ELEMENTS_STATE_DIR, 'session.json');
  const stateHome = environmentVariables.XDG_STATE_HOME ?? resolve(homedir(), '.local', 'state');
  const current = resolve(stateHome, 'inheriti', 'session.json');
  const legacy = resolve(stateHome, 'inheriti-elements', 'session.json');
  return existsSync(current) || !existsSync(legacy) ? current : legacy;
}

/**
 * The operator's refresh token on disk, readable only by its owner.
 *
 * A session that cannot be parsed, or that widened past owner-only permissions, is treated as absent
 * and removed rather than repaired: a half-trusted credential is worse than another login.
 */
export class FileOperatorSessionStore implements OperatorSessionStore {
  private completedClears = 0;
  constructor(private readonly path: string, private readonly keys?: { clear(): Promise<void> }, private readonly business = false) {}

  get successfulClearCount(): number { return this.completedClears; }

  async withExclusiveAccess<T>(operation: () => Promise<T>): Promise<T> {
    const lockPath = `${this.path}.lock`;
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const deadline = Date.now() + 300_000;
    while (true) {
      try {
        await mkdir(lockPath, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await this.recoverAbandonedLock(lockPath);
        if (Date.now() >= deadline) throw new SessionStoreUnreadable('session_lock_timed_out');
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      try {
        await writeFile(`${lockPath}/owner`, String(process.pid), { mode: 0o600, flag: 'wx' });
        return await operation();
      } finally {
        await rm(lockPath, { recursive: true, force: true });
      }
    }
  }

  private async recoverAbandonedLock(lockPath: string): Promise<void> {
    if (!(await this.abandonedLock(lockPath))) return;
    let observed;
    try { observed = await stat(lockPath); }
    catch { return; }
    const recoveryPath = await this.claimRecovery(lockPath);
    if (!recoveryPath) return;
    try {
      let abandoned = await this.abandonedLock(lockPath);
      if (!abandoned) {
        try { await readFile(`${lockPath}/owner`); }
        catch {
          const current = await stat(lockPath);
          abandoned = current.ino === observed.ino && Date.now() - observed.mtimeMs > 10_000;
        }
      }
      if (abandoned) await rm(lockPath, { recursive: true, force: true });
    } finally {
      try {
        if ((await stat(lockPath)).ino === observed.ino) await rm(recoveryPath, { force: true });
      } catch { /* The recovered lock directory has already been removed. */ }
    }
  }

  private async claimRecovery(lockPath: string): Promise<string | undefined> {
    let claims: string[];
    try { claims = (await readdir(lockPath)).filter(name => /^recovery\.[1-9]\d*$/u.test(name)); }
    catch { return undefined; }
    const latest = claims.reduce((highest, name) => Math.max(highest, Number(name.slice('recovery.'.length))), 0);
    if (latest > 0) {
      try {
        const claimant = Number(await readFile(`${lockPath}/recovery.${latest}`, 'utf8'));
        if (Number.isSafeInteger(claimant) && claimant > 0) {
          try { process.kill(claimant, 0); return undefined; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return undefined; }
        }
      } catch { return undefined; }
    }
    const path = `${lockPath}/recovery.${latest + 1}`;
    const prepared = `${lockPath}/claim.${process.pid}.${++temporaryFileSequence}`;
    try {
      await writeFile(prepared, String(process.pid), { mode: 0o600, flag: 'wx' });
      await link(prepared, path);
      return path;
    } catch { return undefined; }
    finally { await rm(prepared, { force: true }); }
  }

  private async abandonedLock(lockPath: string): Promise<boolean> {
    try {
      const [owner, file] = await Promise.all([readFile(`${lockPath}/owner`, 'utf8'), stat(lockPath)]);
      const pid = Number(owner);
      if (!Number.isSafeInteger(pid) || pid <= 0) return Date.now() - file.mtimeMs > 10_000;
      try { process.kill(pid, 0); return false; }
      catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
    } catch {
      try { return Date.now() - (await stat(lockPath)).mtimeMs > 10_000; }
      catch { return false; }
    }
  }

  async load(): Promise<OperatorSession | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new SessionStoreUnreadable('session_file_unreadable');
    }
    if (!(await this.isOwnerOnly())) {
      await this.clear();
      throw new SessionStoreUnreadable('session_permissions_widened');
    }
    let session: OperatorSession;
    try { session = JSON.parse(raw) as OperatorSession; }
    catch {
      await this.clear();
      throw new SessionStoreUnreadable('session_file_corrupt');
    }
    const stored = session as OperatorSession & { kind?: string; familyId?: string; sessionExpiresAt?: number };
    if (this.business && (stored.kind !== 'business' || !stored.familyId || !stored.refreshToken
      || !Number.isFinite(stored.sessionExpiresAt) || 'idToken' in stored)) {
      await this.clear();
      return undefined;
    }
    return session;
  }

  async save(session: OperatorSession): Promise<void> {
    const current = await this.load();
    if (current && sessionIdentity(current) !== sessionIdentity(session)) await this.keys?.clear();
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${++temporaryFileSequence}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(session), 'utf8'); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, this.path);
      await chmod(this.path, 0o600);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async clear(): Promise<void> {
    try { await this.keys?.clear(); }
    finally { await rm(this.path, { force: true }); }
    this.completedClears++;
  }

  private async isOwnerOnly(): Promise<boolean> {
    try {
      const file = await stat(this.path);
      // Windows mode bits cannot express its ACLs; the session lives in the user's profile.
      return process.platform === 'win32' || (file.mode & 0o077) === 0;
    } catch {
      return false;
    }
  }
}
