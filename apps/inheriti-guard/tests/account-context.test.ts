import { describe, expect, it, vi } from 'vitest';
import { confirmedPanelState, startAccountAddition } from '../src/side-panel/account-context.js';

describe('panel account reconfirmation', () => {
  it('waits for a storage-triggered switch to release its lock before showing the new account', async () => {
    let storageRevision = 0;
    let mutationSettled = false;
    storageRevision += 1;
    const revision = storageRevision;
    const load = vi.fn(async () => mutationSettled
      ? { ok: true as const, state: { kind: 'EMPTY' as const, generation: 2 } }
      : { ok: false as const, error: 'operation-busy' as const });
    const pause = vi.fn(async () => { mutationSettled = true; });

    await expect(confirmedPanelState(load, () => revision === storageRevision, pause))
      .resolves.toEqual({ kind: 'EMPTY', generation: 2 });
    expect(load).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalledOnce();
  });

  it('discards a response after another storage generation change', async () => {
    let storageRevision = 1;
    await expect(confirmedPanelState(async () => {
      storageRevision += 1;
      return { ok: true, state: { kind: 'PLANS', plans: [], generation: 1 } };
    }, () => storageRevision === 1)).resolves.toBeUndefined();
  });
});

describe('Add SafeID account sequencing', () => {
  it('waits for the old workspace to close before starting sign-in', async () => {
    let finishDiscard!: () => void;
    const discard = vi.fn(() => new Promise<void>((resolve) => { finishDiscard = resolve; }));
    const signIn = vi.fn(async () => undefined);
    const recover = vi.fn(async () => undefined);

    const addition = startAccountAddition(discard, () => true, signIn, recover);
    expect(signIn).not.toHaveBeenCalled();
    finishDiscard();
    await addition;
    expect(signIn).toHaveBeenCalledOnce();
    expect(recover).not.toHaveBeenCalled();
  });

  it('drops a pending Add when another panel changes the account', async () => {
    let current = true;
    const signIn = vi.fn(async () => undefined);
    await startAccountAddition(async () => { current = false; }, () => current, signIn, async () => undefined);
    expect(signIn).not.toHaveBeenCalled();
  });
});
