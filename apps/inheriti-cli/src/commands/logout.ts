import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';

/**
 * Clearing local state must succeed even when the stored session is unreadable — that is exactly the
 * state an operator runs this to escape.
 */
export async function logout(context: CliContext, terminal: Terminal): Promise<number> {
  const clearedBefore = context.sessions.successfulClearCount;
  try {
    await context.core.auth.clear();
  } catch (error) {
    if (context.sessions.successfulClearCount === clearedBefore) throw error;
    terminal.writeError('The local session was cleared, but server revocation could not be confirmed.');
  }
  terminal.write('Signed out.');
  return 0;
}
