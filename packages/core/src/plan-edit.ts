import { createNodeQuickPlanEditor, HttpPlanEditPort } from '@safetech/inheriti-client-sdk/node';
import type { DataAsset, PlanEditCandidatePage, PlanEditContext } from '@safetech/inheriti-client-sdk/node';

export function createPlanEditOperations(options: {
  apiUrl: string;
  environment: 'TEST' | 'LIVE';
  organizationId: string;
  getBearerToken: () => Promise<string | undefined>;
  secureSessionStorage: NonNullable<Parameters<typeof createNodeQuickPlanEditor>[0]['secureSessionStorage']>;
  payloadStorage: NonNullable<Parameters<typeof createNodeQuickPlanEditor>[0]['payloadStorage']>;
  editRecoveryStore: NonNullable<Parameters<typeof createNodeQuickPlanEditor>[0]['editRecoveryStore']>;
  fetchImpl?: typeof fetch;
}) {
  const transport = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const bearer = async () => (await options.getBearerToken()) ?? null;
  const port = new HttpPlanEditPort(options.apiUrl, options.environment, bearer, transport);
  let active: { planId: string; editId: string; value: ReturnType<typeof createNodeQuickPlanEditor> } | undefined;
  const clearRevealed = () => {
    active?.value.clearRevealedAssets(active.planId);
    active = undefined;
  };
  const editor = (planId: string, editId: string) => {
    if (active?.planId === planId && active.editId === editId) return active.value;
    clearRevealed();
    const value = createNodeQuickPlanEditor({
      apiUrl: options.apiUrl, environment: options.environment, organizationId: options.organizationId, planId, editId,
      getBearerToken: bearer, transport, secureSessionStorage: options.secureSessionStorage, payloadStorage: options.payloadStorage,
      editRecoveryStore: options.editRecoveryStore,
    });
    active = { planId, editId, value };
    return value;
  };
  return {
    clearRevealed,
    list: (cursor?: string): Promise<PlanEditCandidatePage> => port.listEligibleCandidates(options.organizationId, cursor),
    context: (planId: string): Promise<PlanEditContext> => port.context(options.organizationId, planId),
    start: (planId: string, mode: 'DIRECT' | 'GOVERNED', idempotencyKey: string): Promise<{ id: string }> => port.start(options.organizationId, planId, mode, idempotencyKey),
    add: async (planId: string, editId: string, totalShares: number, asset: Omit<DataAsset, 'id'>): Promise<{ status: 'UPDATED' | 'RECOVERY_REQUIRED' }> => {
      const result = await editor(planId, editId).addAsset({ organizationId: options.organizationId, planId, editId, totalShares, asset });
      if (result.status === 'UPDATED') clearRevealed();
      return result;
    },
    listAssets: (planId: string, editId: string) => editor(planId, editId).listAssets({ organizationId: options.organizationId, planId, editId }),
    getAsset: (planId: string, editId: string, assetId: string) => editor(planId, editId).getAsset({ organizationId: options.organizationId, planId, editId }, assetId),
    recover: async (planId: string, editId: string): Promise<{ status: 'UPDATED' | 'RECOVERY_REQUIRED' }> => {
      const result = await editor(planId, editId).recover({ organizationId: options.organizationId, planId, editId });
      if (result.status === 'UPDATED') clearRevealed();
      return result;
    },
    replace: async (planId: string, editId: string, totalShares: number, assetId: string, asset: Omit<DataAsset, 'id'>) => {
      const result = await editor(planId, editId).replaceAsset({ organizationId: options.organizationId, planId, editId, totalShares, assetId, asset });
      if (result.status === 'UPDATED') clearRevealed();
      return result;
    },
    discard: async (planId: string, editId: string): Promise<void> => {
      try { await editor(planId, editId).discard({ organizationId: options.organizationId, planId, editId }); }
      finally { clearRevealed(); }
    },
    discardLocal: async (planId: string, editId = ''): Promise<void> => {
      try { await editor(planId, editId).discardLocal(planId); }
      finally { clearRevealed(); }
    },
  };
}
