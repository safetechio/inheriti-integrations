import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePlanField, revealPlan } from '../src/commands/reveal.js';
import { messageFor } from '../src/main.js';
import type { Terminal } from '../src/output.js';

const { writeClipboard } = vi.hoisted(() => ({ writeClipboard: vi.fn().mockResolvedValue(undefined) }));
vi.mock('clipboardy', () => ({ default: { write: writeClipboard } }));

function terminal(interactive = true): Terminal & { lines: string[] } {
  const lines: string[] = [];
  return { lines, interactive, columns: 200, write: (line) => lines.push(line), writeError: vi.fn() };
}

function context(core: Record<string, unknown>): never {
  return { core: {
    getAccessToken: async () => 'token',
    getPlan: async () => ({ assets: [], revealPolicy: { custodian: 'BYPASS' } }),
    ...core,
  } } as never;
}

function consuming(value: unknown) {
  return {
    consumeFields: async (fields: ReadonlyArray<{ selector: string }>, destination: (values: unknown[]) => unknown) =>
      destination(fields.map(({ selector }) => ({ selector, value }))),
  };
}

describe('plans reveal', () => {
  beforeEach(() => writeClipboard.mockClear());

  it('maps a missing organisation key to custody guidance instead of a crypto or class name', () => {
    const error = Object.assign(new Error('master_key_required:INHERITI_BUSINESS:org-1'), {
      name: 'MasterKeyRequired',
    });

    expect(messageFor(error)).toBe(
      'The organisation key is unavailable. Check this host\'s key custody configuration.',
    );
  });

  // Interactively this opens the picker; piped, it stays the printed list a script can read.
  it('lists selectors without opening or printing secret values when no field was requested', async () => {
    const output = terminal(false);
    const withReveal = vi.fn();
    await revealPlan(context({
      getPlan: async () => ({ assets: [{ id: 'asset-1', code: 'prod-db', fieldNames: ['username', 'password'] }] }),
      withReveal,
    }), output, 'plan-1', {});

    expect(output.lines).toEqual(['Available fields:\n  prod-db.username\n  prod-db.password']);
    expect(withReveal).not.toHaveBeenCalled();
  });

  it('copies the explicitly requested field without printing it and delegates lifecycle closure to withReveal', async () => {
    const output = terminal();
    const consumeFields = vi.fn(async (
      fields: ReadonlyArray<{ selector: string }>,
      destination: (values: ReadonlyArray<{ selector: string; value: unknown }>) => unknown,
    ) => destination(
      fields.map(({ selector }) => ({ selector, value: 'correct horse battery staple' })),
    ));
    const withReveal = vi.fn(async (_planId, options, work) => {
      options.onProgress({ phase: 'RELEASING_MATERIAL', session: { stage: 'AUTHORIZED' } });
      return work({ consumeFields });
    });

    await revealPlan(context({ withReveal }), output, 'plan-1', { field: 'prod-db.password' });

    expect(consumeFields).toHaveBeenCalledWith(
      [{ selector: 'prod-db.password', options: { action: 'COPY_FIELD' } }], expect.any(Function),
    );
    expect(output.lines).toEqual([
      'Opening the plan.', 'Collecting encrypted data shares.',
      'Copied prod-db.password to the clipboard.',
    ]);
    expect(writeClipboard).toHaveBeenCalledWith('correct horse battery staple');
    expect(withReveal).toHaveBeenCalledOnce();
  });

  it('copies multiple fields in one reveal while authorizing and tracking each copy interaction', async () => {
    const output = terminal();
    const values = new Map([['prod-db.username', 'alice'], ['prod-db.password', 'do-not-print']]);
    const consumeFields = vi.fn(async (
      fields: ReadonlyArray<{ selector: string }>,
      destination: (values: ReadonlyArray<{ selector: string; value: unknown }>) => unknown,
    ) => destination(
      fields.map(({ selector }) => ({ selector, value: values.get(selector) })),
    ));
    const withReveal = vi.fn(async (_planId, _options, work) => work({ consumeFields }));

    await revealPlan(context({ withReveal }), output, 'plan-1', {
      fields: ['prod-db.username', 'prod-db.password'],
    });

    expect(withReveal).toHaveBeenCalledOnce();
    expect(consumeFields).toHaveBeenCalledWith([
      { selector: 'prod-db.username', options: { action: 'COPY_FIELD' } },
      { selector: 'prod-db.password', options: { action: 'COPY_FIELD' } },
    ], expect.any(Function));
    expect(writeClipboard).toHaveBeenCalledWith('prod-db.username: alice\nprod-db.password: do-not-print');
    expect(output.lines).toEqual(['Opening the plan.', 'Copied 2 fields to the clipboard.']);
    expect(output.lines.join('\n')).not.toContain('alice');
    expect(output.lines.join('\n')).not.toContain('do-not-print');
  });

  it('resolves one field as pipe-only output without mixing progress into stdout', async () => {
    const output = terminal(false);
    const withReveal = vi.fn(async (_planId, options, work) => {
      options.onProgress({ phase: 'RELEASING_MATERIAL', session: { stage: 'AUTHORIZED' } });
      return work(consuming('machine-secret'));
    });

    await resolvePlanField(context({
      getPlan: async () => ({ assets: [{ id: 'asset-1', code: 'prod-db', fieldNames: ['password'] }] }),
      withReveal,
    }), output, 'plan-1', 'prod-db.password');

    expect(output.lines).toEqual(['machine-secret']);
  });

  it('renders governed waiting progress without exposing protocol stages', async () => {
    const output = terminal();
    const withReveal = vi.fn(async (_planId, options, work) => {
      options.onProgress({ phase: 'WAITING_FOR_AUTHENTICATION', session: { stage: 'WAITING_FOR_PARTICIPANTS' } });
      options.onProgress({ phase: 'WAITING_FOR_AUTHENTICATION', session: { stage: 'WAITING_FOR_PARTICIPANTS' } });
      options.onProgress({ phase: 'RELEASING_MATERIAL', session: { stage: 'AUTHORIZED' } });
      return work(consuming('requested-secret'));
    });

    await revealPlan(context({ withReveal }), output, 'plan-1', { field: 'prod-db.password' });

    expect(output.lines).toEqual([
      'Opening the plan.',
      // The layer before moderation is the member's own confirmation, and it is named as one.
      'Confirm this access on SafeKey Mobile. The request was sent to your device.',
      'Collecting encrypted data shares.',
      'Copied prod-db.password to the clipboard.',
    ]);
    expect(output.lines.join('\n')).not.toContain('WAITING_FOR_PARTICIPANTS');
  });

  it('prints server-owned moderator progress and plan-exposed identities', async () => {
    const output = terminal();
    const withReveal = vi.fn(async (_planId, options, work) => {
      options.onProgress({ phase: 'WAITING_FOR_MODERATION', session: { stage: 'WAITING_FOR_PARTICIPANTS', approvedModerators: 1, requiredModerators: 2 } });
      return work(consuming('requested-secret'));
    });
    await revealPlan(context({
      getPlan: async () => ({
        assets: [{ id: 'asset-1', code: 'prod-db', fieldNames: ['password'] }],
        revealPolicy: { custodian: 'BYPASS' },
        participants: [
          { displayName: 'Ada', lifecycle: 'ACTIVE', relationships: ['MODERATOR'] },
          { displayName: 'Grace', lifecycle: 'ACTIVE', relationships: ['MODERATOR'] },
          { displayName: 'Old moderator', lifecycle: 'REVOKED', relationships: ['MODERATOR'] },
        ],
      }),
      withReveal,
    }), output, 'plan-1', { field: 'prod-db.password' });

    expect(output.lines).toEqual([
      'Opening the plan.',
      'Waiting for moderators (1 of 2 approved). Moderators: Ada, Grace.',
      'Copied prod-db.password to the clipboard.',
    ]);
  });

  it('renders a live moderator card with individual decisions and aggregate progress', async () => {
    const frames: string[] = [];
    const output = {
      ...terminal(),
      createLiveRegion: () => ({ update: (frame: string) => frames.push(frame), close: vi.fn() }),
    };
    const withReveal = vi.fn(async (_planId, options, work) => {
      options.onProgress({
        phase: 'WAITING_FOR_MODERATION',
        session: {
          stage: 'WAITING_FOR_PARTICIPANTS', approvedModerators: 1, requiredModerators: 2,
          governanceExpiresAt: new Date(Date.now() + 90_000).toISOString(),
          moderators: [
            { id: 'ada-id', status: 'APPROVED' },
            { id: 'grace-id', status: 'PENDING' },
          ],
        },
      });
      return work(consuming('requested-secret'));
    });

    await revealPlan(context({
      getPlan: async () => ({
        assets: [{ id: 'asset-1', code: 'prod-db', fieldNames: ['password'] }],
        participants: [
          { id: 'ada-id', displayName: 'Ada', lifecycle: 'ACTIVE', relationships: ['MODERATOR'] },
          { id: 'grace-id', displayName: 'Grace', lifecycle: 'ACTIVE', relationships: ['MODERATOR'] },
        ],
      }),
      withReveal,
    }), output, 'plan-1', { field: 'prod-db.password' });

    expect(frames.some((frame) => frame.includes('1/2 approved'))).toBe(true);
    expect(frames.some((frame) => frame.includes('✓ Ada  approved'))).toBe(true);
    expect(frames.some((frame) => frame.includes('○ Grace  pending'))).toBe(true);
    expect(frames.some((frame) => frame.includes('Time remaining'))).toBe(true);
    expect(output.lines).toEqual([]);
  });

  // The order a reveal runs: governance first, the shares next, and only then the device's shard.
  // The custodian prompt used to be printed at the governance gate, telling a person to approve
  // something nothing had asked them for yet.
  it('prompts for the custodian device at the custodian step, not at the governance gate', async () => {
    const output = terminal();
    const withReveal = vi.fn(async (_planId, options, work) => {
      options.onProgress({ phase: 'WAITING_FOR_AUTHENTICATION', session: { stage: 'WAITING_FOR_PARTICIPANTS' } });
      options.onProgress({ phase: 'RELEASING_MATERIAL', session: { stage: 'AUTHORIZED' } });
      options.onProgress({ phase: 'WAITING_FOR_CUSTODIAN', session: { stage: 'WAITING_FOR_CUSTODIAN' } });
      return work(consuming('requested-secret'));
    });

    await revealPlan(context({
      getPlan: async () => ({
        assets: [{ id: 'asset-1', code: 'prod-db', fieldNames: ['password'] }],
        revealPolicy: { custodian: 'FORCE' },
      }),
      withReveal,
    }), output, 'plan-1', { field: 'prod-db.password' });

    expect(output.lines).toEqual([
      'Opening the plan.',
      'Confirm this access on SafeKey Mobile. The request was sent to your device.',
      'Collecting encrypted data shares.',
      'Approve the custodian request using SafeKey Mobile. This reveal will continue when the share arrives.',
      'Copied prod-db.password to the clipboard.',
    ]);
    expect(output.lines.join('\n')).not.toContain('WAITING_FOR_PARTICIPANTS');
  });

  it('describes the dead man\'s switch as a wait with its own deadline, never as a failure', async () => {
    const output = terminal();
    const withReveal = vi.fn(async (_planId, options, work) => {
      options.onProgress({ phase: 'WAITING_FOR_DMS', session: { stage: 'WAITING_FOR_DMS', dmsExpiresAt: '2030-03-04T09:30:00.000Z' } });
      options.onProgress({ phase: 'WAITING_FOR_AUTHENTICATION', session: { stage: 'WAITING_FOR_PARTICIPANTS' } });
      options.onProgress({ phase: 'RELEASING_MATERIAL', session: { stage: 'AUTHORIZED' } });
      return work(consuming('requested-secret'));
    });

    await revealPlan(context({ withReveal }), output, 'plan-1', { field: 'prod-db.password' });

    expect(output.lines).toEqual([
      'Opening the plan.',
      'Waiting for the dead man\'s switch until 2030-03-04 09:30 UTC. The designated person can stop this reveal '
        + 'from SafeKey Mobile; otherwise it continues on its own.',
      'Confirm this access on SafeKey Mobile. The request was sent to your device.',
      'Collecting encrypted data shares.',
      'Copied prod-db.password to the clipboard.',
    ]);
    expect(output.lines.join('\n')).not.toContain('WAITING_FOR_DMS');
    expect(output.lines.join('\n')).not.toContain('could not continue');
  });

  it('still explains the dead man\'s switch when the server sent no gate deadline', async () => {
    const output = terminal();
    const withReveal = vi.fn(async (_planId, options, work) => {
      options.onProgress({ phase: 'WAITING_FOR_DMS', session: { stage: 'WAITING_FOR_DMS' } });
      return work(consuming('requested-secret'));
    });

    await revealPlan(context({ withReveal }), output, 'plan-1', { field: 'prod-db.password' });

    expect(output.lines[1]).toBe(
      'Waiting for the dead man\'s switch. The designated person can stop this reveal from SafeKey Mobile; '
        + 'otherwise it continues on its own.',
    );
  });

  it('waits on an unfamiliar non-terminal stage instead of reporting a broken reveal', async () => {
    const output = terminal();
    const withReveal = vi.fn(async (_planId, options, work) => {
      options.onProgress({ phase: 'CONTINUING', session: { stage: 'WAITING_FOR_SOMETHING_ADDED_LATER' } });
      options.onProgress({ phase: 'RELEASING_MATERIAL', session: { stage: 'AUTHORIZED' } });
      return work(consuming('requested-secret'));
    });

    await revealPlan(context({ withReveal }), output, 'plan-1', { field: 'prod-db.password' });

    expect(output.lines[1]).toBe('Waiting for this reveal to continue…');
    expect(output.lines.join('\n')).not.toContain('WAITING_FOR_SOMETHING_ADDED_LATER');
  });

  it('reports a dead man\'s switch reset as a stop, and never as a generic authorization failure', async () => {
    const output = terminal();
    const consumeFields = vi.fn();
    const withReveal = vi.fn(async (_planId, options) => {
      options.onProgress({ phase: 'WAITING_FOR_DMS', session: { stage: 'WAITING_FOR_DMS', dmsExpiresAt: '2030-03-04T09:30:00.000Z' } });
      options.onProgress({ phase: 'STOPPED_BY_DMS', session: { stage: 'CANCELED', closedReason: 'DMS_RESET' } });
      throw Object.assign(new Error('reveal_authorization_ended:CANCELED'), { code: 'reveal_authorization_ended' });
    });

    const failure = await revealPlan(context({ withReveal }), output, 'plan-1', {
      field: 'prod-db.password',
    }).catch((error: unknown) => error);

    expect(messageFor(failure)).toBe('The dead man\'s switch subject stopped this reveal. Nothing was released.');
    expect(consumeFields).not.toHaveBeenCalled();
    expect(output.lines).toEqual([
      'Opening the plan.',
      'Waiting for the dead man\'s switch until 2030-03-04 09:30 UTC. The designated person can stop this reveal '
        + 'from SafeKey Mobile; otherwise it continues on its own.',
    ]);
  });

  it('passes the interrupt signal into the scoped lifecycle', async () => {
    const controller = new AbortController();
    const withReveal = vi.fn().mockRejectedValue(Object.assign(new Error('reveal_canceled'), { name: 'AbortError' }));

    await expect(revealPlan(context({ withReveal }), terminal(), 'plan-1', {
      field: 'prod-db.password', signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(withReveal.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal });
  });

  it('does not print reconstructed material when field access fails', async () => {
    const output = terminal();
    const secret = 'must-not-reach-the-transcript';
    const withReveal = vi.fn(async (_planId, _options, work) => work({
      consumeFields: async () => {
        // Model a failure after reconstruction but before the authorized operation
        // returns a value to the host.
        throw Object.assign(new Error('copy_failed'), { protectedValue: secret });
      },
    }));

    await expect(revealPlan(context({ withReveal }), output, 'plan-1', {
      field: 'prod-db.password',
    })).rejects.toThrow('copy_failed');
    expect(output.lines.join('\n')).not.toContain(secret);
    expect(output.lines).toEqual(['Opening the plan.']);
  });
});

describe('reveal mode', () => {
  it('opens a governed reveal for a governed plan without being told to', async () => {
    let requested: string | undefined;
    const output = terminal(false);
    await revealPlan(context({
      getPlan: async () => ({
        assets: [{ id: 'asset-1', code: 'prod-db', fieldNames: ['password'] }],
        governance: { mode: 'GOVERNED' },
        revealPolicy: { custodian: 'BYPASS' },
      }),
      withReveal: async (_planId: string, options: { mode: string }, work: (reveal: unknown) => Promise<unknown>) => {
        requested = options.mode;
        return await work(consuming('secret'));
      },
    }), output, 'plan-1', { field: 'prod-db.password' });
    expect(requested).toBe('GOVERNED');
  });

  it('opens a direct reveal for a plan with no gate', async () => {
    let requested: string | undefined;
    const output = terminal(false);
    await revealPlan(context({
      getPlan: async () => ({
        assets: [{ id: 'asset-1', code: 'prod-db', fieldNames: ['password'] }],
        governance: { mode: 'DIRECT' },
        revealPolicy: { custodian: 'BYPASS' },
      }),
      withReveal: async (_planId: string, options: { mode: string }, work: (reveal: unknown) => Promise<unknown>) => {
        requested = options.mode;
        return await work(consuming('secret'));
      },
    }), output, 'plan-1', { field: 'prod-db.password' });
    expect(requested).toBe('DIRECT');
  });
});
