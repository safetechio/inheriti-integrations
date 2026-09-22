export interface Terminal {
  write(line: string): void;
  writeError(line: string): void;
  readonly interactive: boolean;
  /** How wide a table may be. A pipe has no width, so a fixed one keeps redirected output stable. */
  readonly columns: number;
  /** A redrawable TTY region. Absent for pipes, tests, and embedded callers. */
  createLiveRegion?(): { update(frame: string): void; close(): void };
}

const SECRET_KEYS = ['accessToken', 'refreshToken', 'idToken', 'access_token', 'refresh_token', 'id_token', 'userCode', 'user_code', 'deviceCode', 'device_code', 'codeVerifier'];

/**
 * Nothing this CLI prints may carry a credential. Rendering goes through here so a new command
 * cannot forget: a JWT-shaped value or a known secret key is replaced, never truncated.
 */
export function redact(value: unknown): unknown {
  if (typeof value === 'string') return looksLikeToken(value) ? '<redacted>' : value;
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key, SECRET_KEYS.includes(key) ? '<redacted>' : redact(entry)]));
  }
  return value;
}

function looksLikeToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\./u.test(value);
}

export function renderJson(terminal: Terminal, value: unknown): void {
  terminal.write(JSON.stringify(redact(value), null, 2));
}

export function processTerminal(): Terminal {
  const interactive = Boolean(process.stdout.isTTY && process.stdin.isTTY);
  return {
    write: (line) => process.stdout.write(`${line}\n`),
    writeError: (line) => process.stderr.write(`${line}\n`),
    interactive,
    columns: process.stdout.columns ?? 120,
    ...(interactive ? { createLiveRegion: () => liveRegion(process.stdout) } : {}),
  };
}

function liveRegion(stdout: NodeJS.WriteStream): { update(frame: string): void; close(): void } {
  let lines = 0;
  stdout.write('\u001B[?25l');
  return {
    update(frame) {
      if (lines > 0) stdout.write(`\u001B[${lines}F\u001B[J`);
      stdout.write(`${frame}\n`);
      lines = Math.max(1, frame.split('\n').length);
    },
    close() { stdout.write('\u001B[?25h'); },
  };
}
