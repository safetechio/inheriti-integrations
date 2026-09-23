import { describe, expect, it } from 'vitest';
import { hasRevealEnded, hasRevealFailed, revealGateCountdown, revealGateDeadline, revealProgressMessage } from '../src/reveal-progress.js';
import type { RevealPhase } from '../src/index.js';

const progress = (phase: RevealPhase | 'WAITING_FOR_CUSTODIAN_CLAIM', session: Record<string, unknown> = {}) =>
  ({ phase, session: { stage: 'ANY', ...session } }) as never;

describe('reveal progress wording', () => {
  // The sequence is the Client SDK's; what is proven here is that every phase it can report has a
  // sentence, and that the three hosts read them from this one catalogue rather than three of them.
  it('names the governance layers as the distinct waits they are', () => {
    expect(revealProgressMessage(progress('WAITING_FOR_DMS'))).toContain('dead man\'s switch');
    expect(revealProgressMessage(progress('WAITING_FOR_AUTHENTICATION'))).toBe(
      'Authentication request sent to SafeKey Mobile. Confirm it to continue.',
    );
    expect(revealProgressMessage(progress('WAITING_FOR_MODERATION'))).toContain('moderator');
  });

  it('uses the Business reveal wording for the shared data phases without exposing storage progress', () => {
    expect(revealProgressMessage(progress('STARTING'))).toBe('Opening the plan.');
    expect(revealProgressMessage(progress('RELEASING_MATERIAL'))).toBe('Collecting encrypted data shares.');
    expect(revealProgressMessage(progress('RECONSTRUCTING'))).toBe('Reconstructing and decrypting shares.');
    expect(revealProgressMessage(progress('OPEN'))).toBe('Revealing the data.');
    expect(revealProgressMessage(progress('RELEASING_MATERIAL'))).not.toContain('storage');
  });

  it('names the key owner from the active integration context', () => {
    expect(revealProgressMessage(progress('WAITING_FOR_MASTER_KEY'))).toContain('Application key');
    expect(revealProgressMessage(progress('WAITING_FOR_MASTER_KEY'), { keyOwner: 'Organisation' }))
      .toContain('Organisation key');
  });

  // The wait that used to be printed at the governance gate, telling a person to approve a request
  // that had not been made yet.
  it('keeps the custodian prompt to the custodian step', () => {
    expect(revealProgressMessage(progress('WAITING_FOR_CUSTODIAN'))).toContain('custodian request');
    expect(revealProgressMessage(progress('WAITING_FOR_AUTHENTICATION'))).not.toContain('custodian');
    expect(revealProgressMessage(progress('WAITING_FOR_MODERATION'))).not.toContain('custodian');
  });

  it('distinguishes a pending first claim from a later release approval', () => {
    expect(revealProgressMessage(progress('WAITING_FOR_CUSTODIAN_CLAIM'))).toContain('Claim the custodian share');
    expect(revealProgressMessage(progress('WAITING_FOR_CUSTODIAN_CLAIM'))).toContain('then release it');
    expect(revealProgressMessage(progress('CONNECTING_SAFEKEY_PRO'))).toContain('SafeKey PRO PIN');
    expect(revealProgressMessage(progress('WAITING_FOR_CUSTODIAN_CLAIM'))).not.toContain('Approve');
    expect(revealProgressMessage(progress('WAITING_FOR_CUSTODIAN'))).toContain('Approve');
  });

  it('counts moderators and names them when a host knows who they are', () => {
    const waiting = progress('WAITING_FOR_MODERATION', { approvedModerators: 1, requiredModerators: 2 });

    expect(revealProgressMessage(waiting)).toBe('Waiting for moderators (1 of 2 approved).');
    expect(revealProgressMessage(waiting, { moderators: ['Ada', 'Grace'] }))
      .toBe('Waiting for moderators (1 of 2 approved). Moderators: Ada, Grace.');
  });

  it('identifies the denying governance decision and names only verified moderators', () => {
    const names = new Map([['m1', 'Ada']]);
    expect(revealProgressMessage(progress('DENIED', { deniedBy: 'AUTHENTICATION' })))
      .toBe('Your authentication request was rejected in SafeKey Mobile. Access was denied.');
    expect(revealProgressMessage(progress('DENIED', { deniedBy: 'MODERATION', moderators: [{ id: 'm1', status: 'REJECTED' }] }),
      { moderatorNamesById: names })).toBe('Ada rejected the moderator approval request. Access was denied.');
    expect(revealProgressMessage(progress('DENIED', { deniedBy: 'MODERATION' })))
      .toBe('A moderator rejected the approval request. Access was denied.');
    expect(revealProgressMessage(progress('DENIED'))).toBe('Access denied. The decision could not be identified.');
  });

  it('states a gate deadline as an absolute instant, and omits one it was not given', () => {
    expect(revealProgressMessage(progress('WAITING_FOR_DMS', { dmsExpiresAt: '2030-03-04T09:30:00.000Z' })))
      .toContain('until 2030-03-04 09:30 UTC');
    expect(revealProgressMessage(progress('WAITING_FOR_DMS'))).not.toContain('until');
  });

  it('selects and formats only the active governance deadline', () => {
    const now = new Date('2030-03-04T09:28:29.500Z').getTime();
    const authentication = progress('WAITING_FOR_AUTHENTICATION', {
      expiresAt: '2040-01-01T00:00:00.000Z', governanceExpiresAt: '2030-03-04T09:30:00.000Z',
    });
    const moderation = progress('WAITING_FOR_MODERATION', { governanceExpiresAt: '2030-03-04T09:30:00.000Z' });
    const dms = progress('WAITING_FOR_DMS', {
      governanceExpiresAt: '2040-01-01T00:00:00.000Z', dmsExpiresAt: '2030-03-04T09:30:00.000Z',
    });

    expect(revealGateDeadline(authentication)).toBe('2030-03-04T09:30:00.000Z');
    expect(revealGateDeadline(moderation)).toBe('2030-03-04T09:30:00.000Z');
    expect(revealGateDeadline(dms)).toBe('2030-03-04T09:30:00.000Z');
    expect(revealGateCountdown(authentication, now)).toBe('01:31');
    expect(revealGateCountdown(progress('RELEASING_MATERIAL', { governanceExpiresAt: '2030-03-04T09:30:00.000Z' }), now)).toBeUndefined();
  });

  it('treats a phase it cannot name as a wait, never as a failure', () => {
    expect(revealProgressMessage(progress('CONTINUING'))).toBe('Waiting for this reveal to continue…');
    expect(hasRevealFailed('CONTINUING')).toBe(false);
    expect(hasRevealEnded('CONTINUING')).toBe(false);
  });

  it('separates the reveals that ended empty-handed from the one that opened', () => {
    for (const phase of ['DENIED', 'EXPIRED', 'PARTICIPANT_REVOKED', 'RECONCILIATION_REQUIRED'] as const) {
      expect(hasRevealFailed(phase)).toBe(true);
      expect(hasRevealEnded(phase)).toBe(true);
    }
    expect(hasRevealFailed('OPEN')).toBe(false);
    expect(hasRevealEnded('OPEN')).toBe(true);
  });
});
