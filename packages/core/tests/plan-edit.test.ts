import { describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  createEditor: vi.fn(), listAssets: vi.fn(), getAsset: vi.fn(), replaceAsset: vi.fn(), clearRevealedAssets: vi.fn(),
  discard: vi.fn(),
}));

vi.mock('@safetech/inheriti-client-sdk/node', () => ({
  HttpPlanEditPort: class {},
  createNodeQuickPlanEditor: mock.createEditor,
}));

import { createPlanEditOperations } from '../src/plan-edit.js';

describe('plan edit operations', () => {
  it.each(['cancel', 'discard'] as const)('retries only a %s before the server allows abort', async (action) => {
    mock.discard.mockReset();
    mock.createEditor.mockReturnValue({ discard: mock.discard, clearRevealedAssets: mock.clearRevealedAssets });
    const operations = createPlanEditOperations({
      apiUrl: 'https://example.test/', environment: 'TEST', organizationId: 'org-1',
      getBearerToken: async () => 'token', secureSessionStorage: {} as never,
      payloadStorage: {} as never, editRecoveryStore: {} as never,
    });
    mock.discard.mockRejectedValueOnce({ code: 'action_not_allowed' });
    await expect(operations[action]('plan-1', 'edit-1')).rejects.toMatchObject({ code: 'action_not_allowed' });
    expect(mock.discard).toHaveBeenCalledTimes(1);
    mock.discard.mockRejectedValueOnce({ code: 'too_early_to_abort' });
    await operations[action]('plan-1', 'edit-1');
    expect(mock.discard).toHaveBeenCalledTimes(3);
    expect(mock.discard).toHaveBeenLastCalledWith({ organizationId: 'org-1', planId: 'plan-1', editId: 'edit-1' });
  });
  it('forwards relay approval state while opening protected assets', async () => {
    mock.createEditor.mockReturnValue({ listAssets: mock.listAssets, clearRevealedAssets: mock.clearRevealedAssets });
    mock.listAssets.mockImplementationOnce(async (input) => { await input.acquireMasterKey(); return []; });
    const approval = vi.fn();
    const acquireKey = vi.fn(async (_signal?: AbortSignal, onRelaySession?: () => void) => { onRelaySession?.(); return 'key'; });
    const operations = createPlanEditOperations({
      apiUrl: 'https://example.test/', environment: 'TEST', organizationId: 'org-1',
      getBearerToken: async () => 'token', acquireKey,
      secureSessionStorage: {} as never, payloadStorage: {} as never, editRecoveryStore: {} as never,
    });
    await operations.listAssets('plan-1', 'edit-1', approval);
    expect(approval).toHaveBeenCalledOnce();
    expect(mock.listAssets).toHaveBeenCalledWith(expect.objectContaining({ acquireMasterKey: expect.any(Function) }), undefined);
    expect(acquireKey).toHaveBeenCalledOnce();
  });
  it('does not request a key for unencrypted assets unless the SDK asks', async () => {
    mock.createEditor.mockReturnValue({ listAssets: mock.listAssets, clearRevealedAssets: mock.clearRevealedAssets });
    mock.listAssets.mockImplementationOnce(async () => []);
    const acquireKey = vi.fn(async () => { throw new Error('unexpected key request'); });
    const operations = createPlanEditOperations({
      apiUrl: 'https://example.test/', environment: 'TEST', organizationId: 'org-1',
      getBearerToken: async () => 'token', acquireKey,
      secureSessionStorage: {} as never, payloadStorage: {} as never, editRecoveryStore: {} as never,
    });
    await expect(operations.listAssets('plan-1', 'edit-1')).resolves.toEqual([]);
    expect(acquireKey).not.toHaveBeenCalled();
  });
  it('forwards SDK opening progress while listing assets', async () => {
    mock.createEditor.mockReturnValue({ listAssets: mock.listAssets, clearRevealedAssets: mock.clearRevealedAssets });
    mock.listAssets.mockImplementationOnce(async (_input, onProgress) => { onProgress('collecting_shares'); return []; });
    const operations = createPlanEditOperations({
      apiUrl: 'https://example.test/', environment: 'TEST', organizationId: 'org-1',
      getBearerToken: async () => 'token', secureSessionStorage: {} as never,
      payloadStorage: {} as never, editRecoveryStore: {} as never,
    });
    const progress = vi.fn();
    await operations.listAssets('plan-1', 'edit-1', undefined, progress);
    expect(progress).toHaveBeenCalledWith('collecting_shares');
  });
  it('reuses the editor within an edit and releases it on hide', async () => {
    mock.createEditor.mockReturnValue({
      listAssets: mock.listAssets, getAsset: mock.getAsset, replaceAsset: mock.replaceAsset,
      clearRevealedAssets: mock.clearRevealedAssets,
    });
    mock.replaceAsset.mockResolvedValue({ status: 'RECOVERY_REQUIRED' });
    const operations = createPlanEditOperations({
      apiUrl: 'https://example.test/', environment: 'TEST', organizationId: 'org-1',
      getBearerToken: async () => 'token', secureSessionStorage: {} as never,
      payloadStorage: {} as never, editRecoveryStore: {} as never,
    });
    await operations.listAssets('plan-1', 'edit-1');
    await operations.getAsset('plan-1', 'edit-1', 'asset-1');
    await operations.replace('plan-1', 'edit-1', 2, 'asset-1', { type: 'PLAIN-TEXT', meta: { name: 'Note' }, secret: { text: 'secret' } });
    expect(mock.createEditor).toHaveBeenCalledTimes(1);
    operations.clearRevealed();
    expect(mock.clearRevealedAssets).toHaveBeenCalledWith('plan-1');
    await operations.listAssets('plan-1', 'edit-1');
    expect(mock.createEditor).toHaveBeenCalledTimes(2);
  });
});
