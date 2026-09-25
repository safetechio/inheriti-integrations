import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  available: true, cancelReveal: vi.fn(),
  values: new Map<string, unknown>(),
  list: vi.fn(), context: vi.fn(), start: vi.fn(), add: vi.fn(), listAssets: vi.fn(), getAsset: vi.fn(), replace: vi.fn(), abort: vi.fn(), recover: vi.fn(), discard: vi.fn(), cancel: vi.fn(), discardLocal: vi.fn(), clearRevealed: vi.fn(),
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
  createPlanEditOperations: () => ({ list: mock.list, context: mock.context, start: mock.start, add: mock.add, listAssets: mock.listAssets, getAsset: mock.getAsset, replace: mock.replace, abort: mock.abort, recover: mock.recover, discard: mock.discard, cancel: mock.cancel, cancelReveal: mock.cancelReveal, discardLocal: mock.discardLocal, clearRevealed: mock.clearRevealed }),
}));
import { TrayPlanEdit } from '../src/modules/quick-plan/main/plan-edit.js';

const token = `header.${Buffer.from(JSON.stringify({ sub: 'actor-1' })).toString('base64url')}.signature`;
const asset = { type: 'PLAIN-TEXT', meta: { name: 'Note' }, secret: { text: 'secret' } } as const;

beforeEach(() => {
  vi.resetAllMocks();
  mock.available = true;
  mock.values.clear();
  mock.list.mockResolvedValue({ items: [{ id: 'plan-1', name: 'One', status: 'PROTECTED' }], nextCursor: null });
  mock.context.mockResolvedValue({ idempotencyKey: 'key-1', mode: 'DIRECT', totalShares: 2, masterKeyEncrypted: false });
  mock.start.mockResolvedValue({ id: 'edit-1' });
  mock.add.mockResolvedValue({ status: 'UPDATED' });
  mock.listAssets.mockResolvedValue([{ id: 'asset-1', type: 'PLAIN-TEXT', name: 'Note', isMedia: false }]);
  mock.getAsset.mockResolvedValue({ id: 'asset-1', ...asset });
  mock.replace.mockResolvedValue({ status: 'UPDATED', assetId: 'asset-1' });
  mock.recover.mockResolvedValue({ status: 'UPDATED' });
});

describe('TrayPlanEdit', () => {
  it('does not offer Discard edit when listing plans fails without a saved attempt', async () => {
    mock.list.mockRejectedValueOnce(new Error('offline'));
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    expect(edit.state()).toMatchObject({ status: 'error', canDiscard: false, plans: [], message: 'Could not load plans. Try again.' });
    await edit.load(() => {});
    expect(edit.state()).toMatchObject({ status: 'idle', canDiscard: false, plans: [{ id: 'plan-1', name: 'One' }] });
  });
  it('asks for sign-in when the SDK cannot refresh an expired session', async () => {
    mock.list.mockRejectedValueOnce(Object.assign(new Error('The operator must authenticate again'), { code: 'reauthentication_required' }));
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    expect(edit.state()).toMatchObject({ status: 'error', canDiscard: false, needsSignIn: true, message: 'Your session expired. Sign in and try again.' });
  });
  it('reports context, start, and SDK opening progress while listing assets', async () => {
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    const seen: string[] = [];
    mock.listAssets.mockImplementationOnce(async (_planId, _editId, _approval, progress) => {
      progress('checking_edit');
      progress('collecting_shares');
      return [];
    });
    await edit.listAssets('plan-1', () => { if (edit.state().phase) seen.push(edit.state().phase!); });
    expect(seen).toEqual(['loading_context', 'opening_edit', 'checking_edit', 'collecting_shares']);
    expect(edit.state().phase).toBeUndefined();
  });
  it('keeps the matching opening message visible while context and start are pending', async () => {
    let finishContext!: () => void;
    let finishStart!: () => void;
    mock.context.mockImplementationOnce(() => new Promise((resolve) => { finishContext = () => resolve({ idempotencyKey: 'key-1', mode: 'DIRECT', totalShares: 2, masterKeyEncrypted: false }); }));
    mock.start.mockImplementationOnce(() => new Promise((resolve) => { finishStart = () => resolve({ id: 'edit-1' }); }));
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    const pending = edit.add('plan-1', asset, () => {});
    await vi.waitFor(() => expect(edit.state().phase).toBe('loading_context'));
    finishContext();
    await vi.waitFor(() => expect(edit.state().phase).toBe('opening_edit'));
    finishStart();
    await pending;
  });
  it('loads the organization key before starting an authenticated edit session', async () => {
    mock.context.mockResolvedValueOnce({ idempotencyKey: 'key-1', mode: 'GOVERNED', totalShares: 2, masterKeyEncrypted: true });
    let releaseKey!: () => void;
    const acquireKey = vi.fn(() => new Promise<string>((resolve) => { releaseKey = () => resolve('cached-by-sdk'); }));
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token, acquireKey);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    const access = edit.listAssets('plan-1', () => {});
    await vi.waitFor(() => expect(edit.state().phase).toBe('acquiring_key'));
    expect(mock.start).not.toHaveBeenCalled();
    expect(acquireKey).toHaveBeenCalledWith('org-1', expect.any(AbortSignal), expect.any(Function));
    releaseKey();
    await access;
    expect(mock.start).toHaveBeenCalledWith('plan-1', 'GOVERNED', 'key-1');
  });
  it('does not start authentication when the organization key cannot be loaded', async () => {
    mock.context.mockResolvedValueOnce({ idempotencyKey: 'key-1', mode: 'GOVERNED', totalShares: 2, masterKeyEncrypted: true });
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token, async () => { throw new Error('key_unavailable'); });
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    await edit.listAssets('plan-1', () => {});
    expect(mock.start).not.toHaveBeenCalled();
    expect(edit.state().status).toBe('error');
  });
  it('shows SafeKey Mobile approval while a fresh edit key is pending', async () => {
    let release!: () => void;
    const key = new Promise<string>((resolve) => { release = () => resolve('key'); });
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    mock.add.mockImplementationOnce(async (_planId, _editId, _shares, _asset, _progress, onRelaySession) => {
      onRelaySession();
      await key;
      return { status: 'UPDATED' };
    });
    const pending = edit.add('plan-1', asset, () => {});
    await vi.waitFor(() => expect(edit.state().keyStatus).toBe('awaiting'));
    expect(edit.state().status).toBe('saving');
    release();
    await pending;
    expect(edit.state().keyStatus).toBeUndefined();
  });
  it('shows key access only when the SDK requests it', async () => {
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    const seen: Array<{ phase: string | undefined; keyStatus: string | undefined }> = [];
    mock.listAssets.mockImplementationOnce(async (_planId, _editId, _approval, progress) => {
      expect(edit.state().keyStatus).toBeUndefined();
      progress('opening_plan');
      progress('acquiring_key');
      progress('collecting_shares');
      return [];
    });
    await edit.listAssets('plan-1', () => { seen.push({ phase: edit.state().phase, keyStatus: edit.state().keyStatus }); });
    expect(seen).toContainEqual({ phase: 'opening_plan', keyStatus: undefined });
    expect(seen).toContainEqual({ phase: 'acquiring_key', keyStatus: 'accessing' });
    expect(seen).toContainEqual({ phase: 'collecting_shares', keyStatus: undefined });
  });
  it('cancels pending SafeKey access, closes the edit, and clears its checkpoint', async () => {
    let accessSignal: AbortSignal | undefined;
    mock.listAssets.mockImplementationOnce(async (_planId, _editId, _approval, progress, signal) => {
      accessSignal = signal;
      progress('acquiring_key');
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      return [];
    });
    mock.cancel.mockImplementationOnce(async () => { mock.values.delete('plan-edit/attempt'); });

    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    const access = edit.listAssets('plan-1', () => {});
    await vi.waitFor(() => expect(accessSignal).toBeDefined());

    await edit.cancelAccess();

    expect(accessSignal?.aborted).toBe(true);
    expect(mock.cancel).toHaveBeenCalledWith('plan-1', 'edit-1');
    expect(mock.discard).not.toHaveBeenCalled();
    expect(mock.values.has('plan-edit/attempt')).toBe(false);
    expect(edit.state()).toMatchObject({ status: 'idle', assets: [], available: true });
    await expect(access).resolves.toBeUndefined();
  });
  it.each(['pending_auth', 'releasing_custodian_share'] as const)('cancels promptly while %s is pending', async (phase) => {
    let finishRelease!: () => void;
    let finishedLate = false;
    const release = new Promise<void>((resolve) => { finishRelease = resolve; });
    mock.listAssets.mockImplementationOnce(async (_planId, _editId, _approval, progress) => {
      progress(phase);
      await release;
      progress('collecting_shares');
      finishedLate = true;
      return [];
    });
    mock.cancel.mockImplementationOnce(async () => { mock.values.delete('plan-edit/attempt'); });
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    const access = edit.listAssets('plan-1', () => {});
    await vi.waitFor(() => expect(edit.state().phase).toBe(phase));
    await edit.cancelAccess();
    await access;
    expect(mock.cancel).toHaveBeenCalledWith('plan-1', 'edit-1');
    expect(mock.cancelReveal).not.toHaveBeenCalled();
    expect(edit.state().status).toBe('idle');
    finishRelease();
    await vi.waitFor(() => expect(finishedLate).toBe(true));
    expect(edit.state().phase).toBeUndefined();
    expect(edit.state().assets).toEqual([]);
  });
  it('retains the edit checkpoint when closing a canceled edit fails', async () => {
    mock.listAssets.mockResolvedValueOnce([]);
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    await edit.listAssets('plan-1', () => {});
    mock.cancel.mockRejectedValueOnce(new Error('close failed'));

    await expect(edit.cancelAccess()).rejects.toThrow('close failed');

    expect(mock.values.has('plan-edit/attempt')).toBe(true);
    expect(mock.discard).not.toHaveBeenCalled();
  });
  it('reports ordered update phases and retains the failed step for recovery', async () => {
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    const seen: string[] = [];
    mock.add.mockImplementationOnce(async (_planId, _editId, _shares, _asset, progress) => {
      progress('revealing');
      progress('preparing');
      progress('distributing_validators');
      throw new Error('network');
    });
    await edit.add('plan-1', asset, () => { if (edit.state().phase) seen.push(edit.state().phase!); });
    expect(seen).toEqual(['loading_context', 'opening_edit', 'revealing', 'preparing', 'distributing_validators', 'distributing_validators']);
    expect(edit.state()).toMatchObject({ status: 'recovery-required', phase: 'distributing_validators' });
  });
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
    expect(mock.replace).toHaveBeenCalledWith('plan-1', 'edit-1', 2, 'asset-1', asset, expect.any(Function), expect.any(Function));
    expect(mock.start).toHaveBeenCalledTimes(1);
    expect(edit.state().assets).toEqual([]);
    expect(edit.state().status).toBe('updated');
  });

  it('releases the first plan session before listing assets for another plan', async () => {
    mock.list.mockResolvedValueOnce({ items: [
      { id: 'plan-1', name: 'One', status: 'PROTECTED' },
      { id: 'plan-2', name: 'Two', status: 'PROTECTED' },
    ], nextCursor: null });
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    await edit.listAssets('plan-1', () => {});
    mock.discard.mockImplementationOnce(async () => { mock.values.delete('plan-edit/attempt'); });
    await edit.discard();
    mock.start.mockResolvedValueOnce({ id: 'edit-2' });
    await edit.listAssets('plan-2', () => {});
    expect(mock.discard).toHaveBeenCalledWith('plan-1', 'edit-1');
    expect(mock.listAssets).toHaveBeenLastCalledWith('plan-2', 'edit-2', expect.any(Function), expect.any(Function), expect.any(AbortSignal));
    expect(edit.state().planId).toBe('plan-2');
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

  it('returns existing media as IPC-safe base64 without changing metadata', async () => {
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    mock.listAssets.mockResolvedValueOnce([{ id: 'media-1', type: 'DOCUMENT', name: 'Document', isMedia: true }]);
    await edit.listAssets('plan-1', () => {});
    const meta = { name: 'Document', notes: 'Keep', code: 'stable-code', matchOrigins: ['https://example.com'], isMedia: true, mimeType: 'application/pdf', fileName: 'paper.pdf' };
    mock.getAsset.mockResolvedValueOnce({ id: 'media-1', type: 'DOCUMENT', meta, secret: { data: new Blob(['existing bytes']), mimeType: 'application/pdf', fileName: 'paper.pdf' } });
    await expect(edit.getAsset('plan-1', 'media-1')).resolves.toEqual({
      id: 'media-1', type: 'DOCUMENT', meta,
      secret: { data: Buffer.from('existing bytes').toString('base64'), mimeType: 'application/pdf', fileName: 'paper.pdf' },
    });
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
    expect(mock.listAssets).toHaveBeenLastCalledWith('plan-1', 'edit-2', expect.any(Function), expect.any(Function), expect.any(AbortSignal));
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
    expect(mock.add).toHaveBeenCalledWith('plan-1', 'edit-2', 2, asset, expect.any(Function), expect.any(Function));
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

  it('discards a failed asset update and retains its checkpoint until the server aborts', async () => {
    const edit = new TrayPlanEdit('https://example.test/integrations/', 'TEST', async () => token);
    await edit.selectOrganization('org-1');
    await edit.load(() => {});
    mock.add.mockResolvedValueOnce({ status: 'RECOVERY_REQUIRED' });
    await edit.add('plan-1', asset, () => {});
    expect(edit.state().status).toBe('recovery-required');
    mock.discard.mockRejectedValueOnce(new Error('offline'));
    await expect(edit.discard()).rejects.toThrow('offline');
    expect(mock.values.get('plan-edit/attempt')).toMatchObject({ startedAdd: true });
    mock.discard.mockImplementationOnce(async () => { mock.values.delete('plan-edit/attempt'); });
    await edit.discard();
    expect(mock.discard).toHaveBeenCalledWith('plan-1', 'edit-1');
    expect(mock.values.has('plan-edit/attempt')).toBe(false);
    expect(edit.state().status).toBe('idle');
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
