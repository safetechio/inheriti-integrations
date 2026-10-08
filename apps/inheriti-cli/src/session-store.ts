import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { OperatorSession, OperatorSessionStore } from '@safetech/inheriti-elements-core';
import { sessionIdentity } from './key-vault.js';

export class SessionStoreUnreadable extends Error {
  constructor(readonly code: string) { super(code); this.name = 'SessionStoreUnreadable'; }
}

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
  constructor(private readonly path: string, private readonly keys?: { clear(): Promise<void> }) {}

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
    try {
      return JSON.parse(raw) as OperatorSession;
    } catch {
      await this.clear();
      throw new SessionStoreUnreadable('session_file_corrupt');
    }
  }

  async save(session: OperatorSession): Promise<void> {
    const current = await this.load();
    if (current && sessionIdentity(current) !== sessionIdentity(session)) await this.keys?.clear();
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await writeFile(this.path, JSON.stringify(session), { encoding: 'utf8', mode: 0o600 });
    await chmod(this.path, 0o600);
  }

  async clear(): Promise<void> {
    try { await this.keys?.clear(); }
    finally { await rm(this.path, { force: true }); }
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
