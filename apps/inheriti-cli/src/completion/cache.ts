import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { Candidate } from './candidates.js';

/**
 * Completion candidates, kept briefly on disk.
 *
 * A shell asks on every TAB, and an HTTP round trip per keystroke makes completion feel broken. The
 * cache holds plan names and ids — the same class of data as the stored session, so it lives beside
 * it at 0600 and expires in a minute rather than lingering.
 */
const TTL_MS = 60_000;

interface CacheFile {
  [key: string]: { storedAt: number; candidates: Candidate[] } | undefined;
}

export function completionCachePath(
  environmentVariables: Readonly<Record<string, string | undefined>>,
): string {
  const home = environmentVariables.HOME ?? homedir();
  const base = environmentVariables.INHERITI_ELEMENTS_STATE_DIR
    ?? resolve(environmentVariables.XDG_STATE_HOME ?? resolve(home, '.local', 'state'), 'inheriti-elements');
  return resolve(base, 'completion-cache.json');
}

export async function cached(
  path: string,
  key: string,
  produce: () => Promise<Candidate[]>,
  now = Date.now(),
): Promise<Candidate[]> {
  const file = read(path);
  const entry = file[key];
  if (entry && now - entry.storedAt < TTL_MS) return entry.candidates;
  const candidates = await produce();
  write(path, { ...file, [key]: { storedAt: now, candidates } });
  return candidates;
}

function read(path: string): CacheFile {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as CacheFile) : {};
  } catch {
    return {};
  }
}

/** A cache that cannot be written is not an error worth failing a completion over. */
function write(path: string, file: CacheFile): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify(file), { encoding: 'utf8', mode: 0o600 });
  } catch {
    // ignored on purpose
  }
}
