import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  available: true,
  values: new Map<string, unknown>(),
  list: vi.fn(), context: vi.fn(), start: vi.fn(), add: vi.fn(), listAssets: vi.fn(), getAsset: vi.fn(), replace: vi.fn(), abort: vi.fn(), recover: vi.fn(), discard: vi.fn(), discardLocal: vi.fn(), clearRevealed: vi.fn(),
}));
vi.mock('../src/modules/launcher/main/protected-checkpoint.js', () => ({
  ProtectedCheckpoint: class {
    isAvailable() { return mock.available; }
    getItem(key: string) { return mock.values.get(key) ?? null; }
    setItem(key: string, value: unknown) { mock.values.set(key, value); }
    removeItem(key: string) { mock.values.delete(key); }
  },
}));
vi.mock('@safetech/inheriti-elements-core/node', () => ({
  createPlanEditOperations: () => ({ list: mock.list, context: mock.context, start: mock.start, add: mock.add, listAssets: mock.listAssets, getAsset: mock.getAsset, replace: mock.replace, abort: mock.abort, recover: mock.recover, discard: mock.discard, discardLocal: mock.discardLocal, clearRevealed: mock.clearRevealed }),
}));
import { TrayPlanEdit } from '../src/modules/quick-plan/main/plan-edit.js';

const token = `header.${Buffer.from(JSON.stringify({ sub: 'actor-1' })).toString('base64url')}.signature`;
const asset = { type: 'PLAIN-TEXT', meta: { name: 'Note' }, secret: { text: 'secret' } } as const;

beforeEach(() => {
  vi.resetAllMocks();
  mock.available = true;
  mock.values.clear();
  mock.list.mockResolvedValue({ items: [{ id: 'plan-1', name: 'One', status: 'PROTECTED' }], nextCursor: null });
  mock.context.mockResolvedValue({ idempotencyKey: 'key-1', mode: 'DIRECT', totalShares: 2 });
  mock.start.mockResolvedValue({ id: 'edit-1' });
  mock.add.mockResolvedValue({ status: 'UPDATED' });
  mock.listAssets.mockResolvedValue([{ id: 'asset-1', type: 'PLAIN-TEXT', name: 'Note', isMedia: false }]);
  mock.getAsset.mockResolvedValue({ id: 'asset-1', ...asset });
  mock.replace.mockResolvedValue({ status: 'UPDATED', assetId: 'asset-1' });
  mock.recover.mockResolvedValue({ status: 'UPDATED' });
});

describe('TrayPlanEdit', () => {
  it('allows a selected eligible plan and preserves the server idempotency key for retry', async () => {
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    expect(edit.state().plans).toEqual([{ id: 'plan-1', name: 'One' }]);
    mock.start.mockRejectedValueOnce(new Error('network'));
    await edit.add('plan-1', asset, () => {});
    await edit.add('plan-1', asset, () => {});
    expect(mock.context).toHaveBeenCalledTimes(1);
    expect(mock.start).toHaveBeenNthCalledWith(2, 'plan-1', 'DIRECT', 'key-1');
    expect(edit.state().status).toBe('updated');
  });

  it('denies an unlisted plan and unavailable checkpoint', async () => {
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    await expect(edit.add('another-plan', asset, () => {})).rejects.toThrow('plan_unavailable');
    mock.available = false;
    await expect(edit.add('plan-1', asset, () => {})).rejects.toThrow('unavailable');
    expect(mock.start).not.toHaveBeenCalled();
  });

  it('reveals only selected asset and replaces it under the same edit session', async () => {
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    await edit.listAssets('plan-1', () => {});
    expect(edit.state().assets).toEqual([{ id: 'asset-1', type: 'PLAIN-TEXT', name: 'Note', isMedia: false }]);
    expect(edit.state()).not.toHaveProperty('secret');
    expect(await edit.getAsset('plan-1', 'asset-1')).toEqual({ id: 'asset-1', ...asset });
    await edit.replace('plan-1', 'asset-1', asset, () => {});
    expect(mock.replace).toHaveBeenCalledWith('plan-1', 'edit-1', 2, 'asset-1', asset);
    expect(mock.start).toHaveBeenCalledTimes(1);
    expect(edit.state().assets).toEqual([]);
    expect(edit.state().status).toBe('updated');
  });

  it('rejects changing the selected asset type', async () => {
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    await edit.listAssets('plan-1', () => {});
    await expect(edit.replace('plan-1', 'asset-1', { type: 'PIN-CODE', meta: { name: 'PIN' }, secret: { pinCode: '1234' } } as never, () => {})).rejects.toThrow('asset_unavailable');
    expect(mock.replace).not.toHaveBeenCalled();
  });

  it('blocks cleanup and organization changes while revealing an asset', async () => {
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    await edit.listAssets('plan-1', () => {});
    let finishReveal!: (value: { id: string; type: string; meta: { name: string }; secret: { text: string } }) => void;
    mock.getAsset.mockImplementationOnce(() => new Promise((resolve) => { finishReveal = resolve; }));
    const revealed = edit.getAsset('plan-1', 'asset-1');
    await expect(edit.clear()).rejects.toThrow('edit_in_progress');
    await expect(edit.discard()).rejects.toThrow('edit_in_progress');
    await expect(edit.selectOrganization('org-2')).rejects.toThrow('edit_in_progress');
    finishReveal({ id: 'asset-1', ...asset });
    await expect(revealed).resolves.toEqual({ id: 'asset-1', ...asset });
    await edit.discard();
  });

  it('retains recovery after a conflict returned from replacement', async () => {
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    await edit.listAssets('plan-1', () => {});
    mock.replace.mockRejectedValueOnce({ status: 409 });
    await edit.replace('plan-1', 'asset-1', asset, () => {});
    expect(edit.state().status).toBe('recovery-required');
    expect(edit.state().message).toMatch(/Another edit/);
    expect(mock.values.get('plan-edit/attempt')).toMatchObject({ startedAdd: true });
  });

  it('clears revealed state on hide without losing a recovery checkpoint', async () => {
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    await edit.listAssets('plan-1', () => {});
    mock.replace.mockResolvedValueOnce({ status: 'RECOVERY_REQUIRED' });
    await edit.replace('plan-1', 'asset-1', asset, () => {});
    edit.clearRevealed();
    expect(mock.clearRevealed).toHaveBeenCalled();
    expect(edit.state().assets).toEqual([]);
    expect(mock.values.get('plan-edit/attempt')).toMatchObject({ startedAdd: true });
  });

  it('discards a hidden precommit edit before reopening the asset list', async () => {
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    await edit.listAssets('plan-1', () => {});
    edit.clearRevealed();
    mock.discard.mockImplementationOnce(async () => { mock.values.delete('plan-edit/attempt'); });
    mock.start.mockResolvedValueOnce({ id: 'edit-2' });
    await edit.listAssets('plan-1', () => {});
    expect(mock.discard).toHaveBeenCalledWith('plan-1', 'edit-1');
    expect(mock.start).toHaveBeenCalledTimes(2);
    expect(mock.listAssets).toHaveBeenLastCalledWith('plan-1', 'edit-2');
  });

  it('discards a hidden precommit edit before adding an asset', async () => {
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    await edit.listAssets('plan-1', () => {});
    edit.clearRevealed();
    mock.discard.mockImplementationOnce(async () => { mock.values.delete('plan-edit/attempt'); });
    mock.start.mockResolvedValueOnce({ id: 'edit-2' });
    await edit.add('plan-1', asset, () => {});
    expect(mock.discard).toHaveBeenCalledWith('plan-1', 'edit-1');
    expect(mock.context).toHaveBeenCalledTimes(2);
    expect(mock.add).toHaveBeenCalledWith('plan-1', 'edit-2', 2, asset);
    expect(edit.state().status).toBe('updated');
  });

  it('rejects a reveal that completes after the window hides', async () => {
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    await edit.listAssets('plan-1', () => {});
    let finishReveal!: (value: { id: string; type: string; meta: { name: string }; secret: { text: string } }) => void;
    mock.getAsset.mockImplementationOnce(() => new Promise((resolve) => { finishReveal = resolve; }));
    const revealed = edit.getAsset('plan-1', 'asset-1');
    edit.clearRevealed();
    finishReveal({ id: 'asset-1', ...asset });
    await expect(revealed).rejects.toThrow('edit_dismissed');
    expect(edit.state().assets).toEqual([]);
  });

  it('does not start an edit after context denies VIEW-only access', async () => {
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    mock.context.mockRejectedValue(new Error('plan_scope_denied'));
    await edit.add('plan-1', asset, () => {});
    expect(edit.state().status).toBe('error');
    expect(mock.start).not.toHaveBeenCalled();
  });

  it('rejects a checkpoint from another organization before starting', async () => {
    mock.values.set('plan-edit/attempt', { actor: 'actor-1', organizationId: 'org-2', planId: 'plan-1', idempotencyKey: 'old-key', mode: 'DIRECT', totalShares: 2 });
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    await edit.add('plan-1', asset, () => {});
    expect(edit.state().status).toBe('error');
    expect(mock.context).not.toHaveBeenCalled();
    expect(mock.start).not.toHaveBeenCalled();
  });

  it('recovers a saved edit without creating another asset', async () => {
    const original = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await original.selectOrganization('org-1');
    await original.load(() => {});
    mock.add.mockResolvedValueOnce({ status: 'RECOVERY_REQUIRED' });
    await original.add('plan-1', asset, () => {});
    expect(mock.values.has('plan-edit/attempt')).toBe(true);
    mock.add.mockClear();
    mock.recover.mockImplementationOnce(async () => { mock.values.delete('plan-edit/attempt'); return { status: 'UPDATED' }; });
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    expect(edit.state().status).toBe('recovery-required');
    await edit.recover(() => {});
    expect(mock.recover).toHaveBeenCalledWith('plan-1', 'edit-1');
    expect(mock.add).not.toHaveBeenCalled();
    expect(mock.values.has('plan-edit/attempt')).toBe(false);
  });

  it('uses only local cleanup when discarding another actor checkpoint', async () => {
    mock.values.set('plan-edit/attempt', { actor: 'prior-actor', organizationId: 'org-1', planId: 'plan-1', idempotencyKey: 'key-1', mode: 'DIRECT', totalShares: 2, editId: 'edit-1', startedAdd: true });
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    expect(edit.state().actorMismatch).toBe(true);
    mock.discardLocal.mockImplementationOnce(async () => { mock.values.delete('plan-edit/attempt'); });
    await edit.discard();
    expect(mock.discardLocal).toHaveBeenCalledWith('plan-1', 'edit-1');
    expect(mock.discard).not.toHaveBeenCalled();
    expect(mock.values.has('plan-edit/attempt')).toBe(false);
  });

  it('preserves an ambiguous edit across sign-out before opening the picker', async () => {
    mock.values.set('plan-edit/attempt', { actor: 'actor-1', organizationId: 'org-1', planId: 'plan-1', idempotencyKey: 'key-1', mode: 'DIRECT', totalShares: 2, editId: 'edit-1', startedAdd: true });
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await expect(edit.selectOrganization('org-2')).rejects.toThrow('edit_recovery_required');
    await edit.clear();
    expect(mock.values.has('plan-edit/attempt')).toBe(true);
    expect(mock.discard).not.toHaveBeenCalled();
    expect(mock.discardLocal).not.toHaveBeenCalled();
  });

  it('does not silently discard another actor checkpoint on sign-out', async () => {
    mock.values.set('plan-edit/attempt', { actor: 'prior-actor', organizationId: 'org-1', planId: 'plan-1', idempotencyKey: 'key-1', mode: 'DIRECT', totalShares: 2 });
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.clear();
    expect(mock.values.has('plan-edit/attempt')).toBe(true);
    expect(mock.discardLocal).not.toHaveBeenCalled();
  });
});
