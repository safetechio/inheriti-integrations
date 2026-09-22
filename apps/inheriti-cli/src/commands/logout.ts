import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';

/**
 * Clearing local state must succeed even when the stored session is unreadable — that is exactly the
 * state an operator runs this to escape.
 */
export async function logout(context: CliContext, terminal: Terminal): Promise<number> {
  try {
    await context.core.auth.clear();
  } finally {
    await context.sessions.clear();
  }
  terminal.write('Signed out.');
  return 0;
}
