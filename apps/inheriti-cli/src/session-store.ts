import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { OperatorSession, OperatorSessionStore } from '@safetech/inheriti-elements-core';

export class SessionStoreUnreadable extends Error {
  constructor(readonly code: string) { super(code); this.name = 'SessionStoreUnreadable'; }
}

export function defaultSessionPath(environmentVariables: Readonly<Record<string, string | undefined>>): string {
  const base = environmentVariables.INHERITI_ELEMENTS_STATE_DIR
    ?? resolve(environmentVariables.XDG_STATE_HOME ?? resolve(homedir(), '.local', 'state'), 'inheriti-elements');
  return resolve(base, 'session.json');
}

/**
 * The operator's refresh token on disk, readable only by its owner.
 *
 * A session that cannot be parsed, or that widened past owner-only permissions, is treated as absent
 * and removed rather than repaired: a half-trusted credential is worse than another login.
 */
export class FileOperatorSessionStore implements OperatorSessionStore {
  constructor(private readonly path: string) {}

  async load(): Promise<OperatorSession | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch {
      return undefined;
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
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await writeFile(this.path, JSON.stringify(session), { encoding: 'utf8', mode: 0o600 });
    await chmod(this.path, 0o600);
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }

  private async isOwnerOnly(): Promise<boolean> {
    try {
      return ((await stat(this.path)).mode & 0o077) === 0;
    } catch {
      return false;
    }
  }
}
