import { describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  createEditor: vi.fn(), listAssets: vi.fn(), getAsset: vi.fn(), replaceAsset: vi.fn(), clearRevealedAssets: vi.fn(),
}));

vi.mock('@safetech/inheriti-client-sdk/node', () => ({
  HttpPlanEditPort: class {},
  createNodeQuickPlanEditor: mock.createEditor,
}));

import { createPlanEditOperations } from '../src/plan-edit.js';

describe('plan edit operations', () => {
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
