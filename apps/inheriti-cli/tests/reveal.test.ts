import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePlanField, revealPlan } from '../src/commands/reveal.js';
import { messageFor } from '../src/main.js';
import type { Terminal } from '../src/output.js';

const { writeClipboard, readClipboard } = vi.hoisted(() => ({ writeClipboard: vi.fn().mockResolvedValue(undefined), readClipboard: vi.fn() }));
vi.mock('clipboardy', () => ({ default: { write: writeClipboard, read: readClipboard } }));

function terminal(interactive = true): Terminal & { lines: string[] } {
  const lines: string[] = [];
  return { lines, stdoutIsTTY: false, interactive, columns: 200, write: (line) => lines.push(line), writeError: vi.fn() };
}

function context(core: Record<string, unknown>): never {
  return { core: {
    getAccessToken: async () => 'token',
    getPlan: async () => ({ assets: [], revealPolicy: { custodian: 'FORCE' } }),
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

  it.each(['asset_selector_invalid', 'asset_not_found', 'asset_field_not_found', 'asset_value_invalid', 'asset_decoder_required'])
    ('explains %s without exposing the raw code or protected data', (code) => {
      const message = messageFor(Object.assign(new Error(code), { code, protectedValue: 'private-secret' }));
      expect(message).not.toContain(code);
      expect(message).not.toContain('private-secret');
      expect(message).toMatch(/asset|field|decode/);
    });

  it('maps a missing organisation key to custody guidance instead of a crypto or class name', () => {
    const error = Object.assign(new Error('master_key_required:INHERITI_BUSINESS:org-1'), {
      name: 'MasterKeyRequired',
      ref: { system: 'INHERITI_BUSINESS', contextId: 'org-1' },
    });

    expect(messageFor(error)).toBe(
      'The Organisation key is not available from SafeKey Mobile for this account.',
    );
  });

  it('does not claim cancellation succeeded when the relay cleanup failed', () => {
    expect(messageFor({ code: 'master_key_relay_cancellation_failed' })).toContain('may still be pending');
  });

  it('explains how to recover when server reveal cancellation is unconfirmed', () => {
    expect(messageFor({ code: 'reveal_cancellation_failed' })).toBe(
      'The local reveal stopped, but server cancellation could not be confirmed. Run `inheriti plans abort PLAN_ID` with this plan ID before revealing again, or wait for the request to expire.',
    );
  });

  it('guides a direct runner away from a claimed SafeKey PRO share', () => {
    expect(messageFor({ code: 'safekey_pro_local_device_required' })).toContain('Open it locally');
  });

  it('does not blame SafeKey Mobile for a missing or mismatched PRO share', () => {
    expect(messageFor({ code: 'custodian_share_unavailable' })).toBe(
      'The custodian share is unavailable or does not match this plan and device.',
    );
  });

  it('explains how to restart an interrupted governed reveal without exposing its raw code', () => {
    expect(messageFor({ code: 'reveal_restart_required' })).toBe(
      'An earlier reveal of this plan cannot continue. Run `inheriti plans abort PLAN_ID` with this plan ID, then retry your reveal command.',
    );
  });

  it('names the Business organisation in plan errors while preserving standalone copy', () => {
    expect(messageFor({ code: 'plan_not_found' }, true)).toBe('No such plan in this Organisation.');
    expect(messageFor({ code: 'plan_not_found' })).toBe('No such plan in this Application.');
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

  it('does not offer the local PRO device or prompt for a PIN in a headless reveal', async () => {
    const output = terminal(false);
    const proDevice = { write: vi.fn(), read: vi.fn() };
    const withReveal = vi.fn(async (_planId, options, work) => {
      expect(options.proDevice).toBeUndefined();
      expect(options.selectCustodianDevice).toBeUndefined();
      return work(consuming('private-value'));
    });
    await revealPlan({ ...(context({ withReveal }) as object), safeKeyPro: proDevice } as never, output, 'plan-1', { field: 'asset.password' });
    expect(output.lines.join('\n')).not.toContain('private-value');
  });

  it('passes the connected PRO device to an interactive reveal', async () => {
    const proDevice = { write: vi.fn(), read: vi.fn() };
    const withReveal = vi.fn(async (_planId, options, work) => {
      expect(options.proDevice).toBe(proDevice);
      expect(options.selectCustodianDevice).toEqual(expect.any(Function));
      return work(consuming('private-value'));
    });
    const output = terminal(true);
    await revealPlan({ ...(context({ withReveal }) as object), safeKeyPro: proDevice } as never, output, 'plan-1', { field: 'asset.password' });
    expect(output.lines.join('\n')).not.toContain('private-value');
  });

  it('keeps the live reveal card and PIN status inside it through a SafeKey PRO operation', async () => {
    const proDevice = { write: vi.fn(), read: vi.fn(), setStatusRenderer: vi.fn() };
    const region = { update: vi.fn(), close: vi.fn() };
    const createLiveRegion = vi.fn(() => region);
    const withReveal = vi.fn(async (_planId, options, work) => {
      options.onProgress({ phase: 'WAITING_FOR_MASTER_KEY', session: { stage: 'AUTHORIZED' } });
      expect(region.update.mock.calls.at(-1)?.[0]).toContain('Waiting for the Application key');
      options.onProgress({ phase: 'CONNECTING_SAFEKEY_PRO', session: { stage: 'AUTHORIZED' } });
      expect(region.close).not.toHaveBeenCalled();
      const show = proDevice.setStatusRenderer.mock.calls.at(-1)?.[0];
      show('SafeKey PRO PIN (press Enter): ****');
      const frame = region.update.mock.calls.at(-1)?.[0];
      expect(frame).toContain('Revealing your plan');
      expect(frame).toContain('SafeKey PRO PIN (press Enter): ****');
      expect(frame).toContain('╭');
      return work(consuming('private-value'));
    });
    const output = { ...terminal(true), createLiveRegion };
    await revealPlan({ ...(context({ withReveal }) as object), safeKeyPro: proDevice } as never, output, 'plan-1', { field: 'asset.password' });
    expect(createLiveRegion).toHaveBeenCalledOnce();
    expect(region.close).toHaveBeenCalledOnce();
    expect(output.lines.join('\n')).not.toContain('private-value');
  });

  it('keeps the same reveal card after a previously claimed SafeKey PRO share is read', async () => {
    const region = { update: vi.fn(), close: vi.fn() };
    const createLiveRegion = vi.fn(() => region);
    const withReveal = vi.fn(async (_planId, options, work) => {
      options.onProgress({ phase: 'CONNECTING_SAFEKEY_PRO', session: { stage: 'AUTHORIZED' } });
      options.onProgress({ phase: 'RECONSTRUCTING', session: { stage: 'AUTHORIZED' } });
      return work(consuming('private-value'));
    });
    const output = { ...terminal(true), createLiveRegion };
    await revealPlan({ ...(context({ withReveal }) as object), safeKeyPro: { write: vi.fn(), read: vi.fn() } } as never,
      output, 'plan-1', { field: 'asset.password' });
    expect(createLiveRegion).toHaveBeenCalledOnce();
    expect(region.close).toHaveBeenCalledOnce();
    expect(region.update.mock.calls.at(-1)?.[0]).toContain('Reveal complete');
    expect(output.lines).not.toContain('Reconstructing and decrypting shares.');
  });

  it.each([
    ['WAITING_FOR_MASTER_KEY', 'Canceling the SafeKey Mobile request...'],
    ['RECONSTRUCTING', 'Canceling the reveal...'],
  ])('shows Ctrl+C cancellation during %s and closes the live card', async (phase, message) => {
    const controller = new AbortController();
    const region = { update: vi.fn(), close: vi.fn() };
    const withReveal = vi.fn(async (_planId, options) => {
      options.onProgress({ phase });
      await new Promise<void>((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('reveal_canceled'), { name: 'AbortError' })), { once: true });
        controller.abort();
      });
    });
    const output = { ...terminal(true), createLiveRegion: () => region };
    await expect(revealPlan(context({ withReveal }), output, 'plan-1', { field: 'asset.password', signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(region.close).toHaveBeenCalledOnce();
    expect(region.update.mock.calls.at(-1)?.[0]).toContain(message);
    expect(output.writeError).not.toHaveBeenCalled();
    expect(output.lines.join('\n')).not.toContain('secret');
  });

  it('reports quiet reveal cancellation only on stderr', async () => {
    const controller = new AbortController();
    const output = terminal(false);
    const withReveal = vi.fn(async (_planId, options) => {
      options.onProgress({ phase: 'RECONSTRUCTING' });
      controller.abort();
      throw Object.assign(new Error('reveal_canceled'), { name: 'AbortError' });
    });

    await expect(resolvePlanField(context({ withReveal }), output, 'plan-1', 'asset.password', { allowPlaintextOutput: true, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(output.lines).toEqual([]);
    expect(output.writeError).toHaveBeenCalledExactlyOnceWith('Canceling the reveal...');
  });

  it.each([false, true])('shows clipboard and first-access notice after delivery (live region: %s)', async (live) => {
    const frames: string[] = [];
    const output = {
      ...terminal(),
      ...(live ? { createLiveRegion: () => ({ update: (frame: string) => frames.push(frame), close: vi.fn() }) } : {}),
    };
    const withReveal = vi.fn(async (_planId, options, work) => {
      options.onProgress({ phase: 'CUSTODIAN_SHARE_DISTRIBUTED', session: { stage: 'AUTHORIZED' } });
      return work(consuming('secret-value'));
    });
    await revealPlan(context({ withReveal }), output, 'plan-1', { field: 'prod-db.password' });
    const result = live ? frames.at(-1)! : output.lines.join('\n');
    expect(result).toContain('Copied prod-db.password to the clipboard.');
    expect(result).toContain('custodian share was sent to SafeKey Mobile');
    expect(result).toContain('accesses will require you to release it there.');
    expect(result).not.toContain('secret-value');
  });

  it('does not show first-access notice on later access or failed delivery', async () => {
    const later = terminal();
    await revealPlan(context({ withReveal: async (_planId: string, _options: unknown, work: (reveal: unknown) => Promise<unknown>) =>
      work(consuming('secret-value')) }), later, 'plan-1', { field: 'prod-db.password' });
    expect(later.lines.join('\n')).not.toContain('custodian share was sent');

    const failed = terminal();
    await expect(revealPlan(context({ withReveal: async (_planId: string, options: { onProgress: (value: unknown) => void }, work: (reveal: unknown) => Promise<unknown>) => {
      options.onProgress({ phase: 'CUSTODIAN_SHARE_DISTRIBUTED' });
      return work({ consumeFields: async () => { throw new Error('delivery failed'); } });
    } }), failed, 'plan-1', { field: 'prod-db.password' })).rejects.toThrow('delivery failed');
    expect(failed.lines.join('\n')).not.toContain('custodian share was sent');
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
    }), output, 'plan-1', 'prod-db.password', { allowPlaintextOutput: true });

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
      'Authentication request sent to SafeKey Mobile. Confirm it to continue.',
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
        revealPolicy: { custodian: 'FORCE' },
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

  it('reports the rejecting moderator from the final governed decision', async () => {
    const output = terminal();
    const withReveal = vi.fn(async (_planId, options) => {
      options.onProgress({ phase: 'DENIED', session: { stage: 'DENIED', deniedBy: 'MODERATION',
        moderators: [{ id: 'm1', status: 'REJECTED' }] } });
      throw Object.assign(new Error('reveal_denied'), { code: 'reveal_denied' });
    });
    const action = revealPlan(context({
      getPlan: async () => ({ assets: [{ id: 'asset-1', code: 'prod-db', fieldNames: ['password'] }],
        participants: [{ id: 'm1', displayName: 'Ada', lifecycle: 'ACTIVE', relationships: ['MODERATOR'] }] }),
      withReveal,
    }), output, 'plan-1', { field: 'prod-db.password' });

    const error: unknown = await action.catch((cause: unknown) => cause);
    expect(messageFor(error)).toBe('Ada rejected the moderator approval request. Access was denied.');
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
      'Authentication request sent to SafeKey Mobile. Confirm it to continue.',
      'Collecting encrypted data shares.',
      'This custodian share is stored on your phone. Open SafeKey Mobile and approve its release for this access.',
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
      'Authentication request sent to SafeKey Mobile. Confirm it to continue.',
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
        revealPolicy: { custodian: 'FORCE' },
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
        revealPolicy: { custodian: 'FORCE' },
      }),
      withReveal: async (_planId: string, options: { mode: string }, work: (reveal: unknown) => Promise<unknown>) => {
        requested = options.mode;
        return await work(consuming('secret'));
      },
    }), output, 'plan-1', { field: 'prod-db.password' });
    expect(requested).toBe('DIRECT');
  });
});

describe('plaintext destination guard', () => {
  it.each([[true, true, true], [false, true, true], [true, undefined, true], [false, undefined, true], [false, false, false]])
    ('rejects before auth (interactive %s, stdout %s, acknowledged %s)', async (interactive, stdoutIsTTY, allowed) => {
      const getAccessToken = vi.fn();
      const getPlan = vi.fn();
      const withReveal = vi.fn();
      const output = { ...terminal(interactive), stdoutIsTTY: stdoutIsTTY as boolean };
      await expect(resolvePlanField(context({ getAccessToken, getPlan, withReveal }), output, 'plan-1', 'asset.password', { allowPlaintextOutput: allowed })).rejects.toThrow(/Plaintext/);
      expect(getAccessToken).not.toHaveBeenCalled();
      expect(getPlan).not.toHaveBeenCalled();
      expect(withReveal).not.toHaveBeenCalled();
      expect(output.lines).toEqual([]);
    });

  it.each(['asset', 'asset.', '.password', '--asset.password', 'asset. password'])('rejects malformed selector before auth: %s', async (selector) => {
    const getAccessToken = vi.fn();
    await expect(resolvePlanField(context({ getAccessToken }), terminal(false), 'plan-1', selector, { allowPlaintextOutput: true })).rejects.toThrow('Invalid field selector.');
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it.each(['fixture\nwith trailing newline\n', { password: 'fixture' }])('writes only the raw value', async (value) => {
    const output = terminal(false);
    await resolvePlanField(context({ withReveal: async (_id: string, _options: unknown, work: (reveal: unknown) => Promise<unknown>) => work(consuming(value)) }), output, 'plan-1', 'legacy.asset.password', { allowPlaintextOutput: true });
    expect(output.lines).toEqual([typeof value === 'string' ? value : JSON.stringify(value)]);
  });
});

describe('clipboard expiry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    writeClipboard.mockReset().mockResolvedValue(undefined);
    readClipboard.mockReset().mockResolvedValue('fixture-secret');
  });

  async function copied(output: Terminal, options = {}, finalize?: () => void) {
    return revealPlan(context({ withReveal: async (_id: string, _options: unknown, work: (reveal: unknown) => Promise<unknown>) => {
      await work(consuming('fixture-secret'));
      finalize?.();
    } }), output, 'plan-1', { field: 'asset.password', clipboardTtlMs: 100, ...options });
  }

  it('arms cleanup immediately, finishes SDK work, and stays alive until expiry', async () => {
    const output = terminal(false);
    const finalized = vi.fn();
    let done = false;
    const result = copied(output, {}, finalized).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(finalized).toHaveBeenCalledOnce();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(99);
    expect(writeClipboard).toHaveBeenCalledExactlyOnceWith('fixture-secret');
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(writeClipboard).toHaveBeenLastCalledWith('');
    expect(output.lines).toContain('Clipboard expired and cleared.');
    expect(output.lines.join('\n')).not.toContain('fixture-secret');
    vi.useRealTimers();
  });

  it('leaves replaced clipboard content untouched', async () => {
    const output = terminal(false);
    readClipboard.mockResolvedValue('replacement');
    const result = copied(output);
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(writeClipboard).toHaveBeenCalledTimes(1);
    expect(output.lines).toContain('Clipboard changed; left untouched.');
    vi.useRealTimers();
  });

  it.each(['read', 'write'])('reports cleanup %s failure without content', async (stage) => {
    const output = terminal(false);
    if (stage === 'read') readClipboard.mockRejectedValue(new Error('fixture-secret'));
    if (stage === 'write') writeClipboard.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('fixture-secret'));
    const result = copied(output);
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(output.writeError).toHaveBeenCalledWith('Clipboard cleanup failed.');
    expect(output.lines.join('\n')).not.toContain('fixture-secret');
    vi.useRealTimers();
  });

  it('does not arm cleanup after initial copy failure', async () => {
    writeClipboard.mockRejectedValue(new Error('fixture-secret'));
    await expect(copied(terminal(false))).rejects.toMatchObject({ code: 'clipboard_unavailable' });
    expect(vi.getTimerCount()).toBe(0);
    expect(readClipboard).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('clears immediately on cancellation after copying', async () => {
    const output = terminal(false);
    const controller = new AbortController();
    const rejected = expect(copied(output, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await rejected;
    expect(writeClipboard).toHaveBeenLastCalledWith('');
    expect(output.lines).toContain('Clipboard cleared after cancellation.');
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('cleans after SDK finalization fails after copying', async () => {
    const rejected = expect(copied(terminal(false), {}, () => { throw new Error('finalization failed'); })).rejects.toThrow('finalization failed');
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(writeClipboard).toHaveBeenLastCalledWith('');
    vi.useRealTimers();
  });

  it('expires the complete copied batch', async () => {
    const output = terminal(false);
    readClipboard.mockResolvedValue('asset.a: fixture-secret\nasset.b: fixture-secret');
    const result = revealPlan(context({ withReveal: async (_id: string, _options: unknown, work: (reveal: unknown) => Promise<unknown>) => work(consuming('fixture-secret')) }), output, 'plan-1', { fields: ['asset.a', 'asset.b'], clipboardTtlMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(writeClipboard).toHaveBeenNthCalledWith(1, 'asset.a: fixture-secret\nasset.b: fixture-secret');
    expect(writeClipboard).toHaveBeenLastCalledWith('');
    expect(output.lines.join('\n')).not.toContain('fixture-secret');
    vi.useRealTimers();
  });

  it.each([0, -1, 2_147_483_648, Infinity, 1.5])('rejects unsafe duration %s before auth', async (clipboardTtlMs) => {
    const getAccessToken = vi.fn();
    await expect(revealPlan(context({ getAccessToken }), terminal(false), 'plan-1', { field: 'asset.password', clipboardTtlMs })).rejects.toMatchObject({ code: 'clipboard_ttl_invalid' });
    expect(getAccessToken).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
