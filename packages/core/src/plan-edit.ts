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
  const editor = (planId: string, editId: string) => createNodeQuickPlanEditor({
    apiUrl: options.apiUrl, environment: options.environment, organizationId: options.organizationId, planId, editId,
    getBearerToken: bearer, transport, secureSessionStorage: options.secureSessionStorage, payloadStorage: options.payloadStorage,
    editRecoveryStore: options.editRecoveryStore,
  });
  return {
    list: (cursor?: string): Promise<PlanEditCandidatePage> => port.listEligibleCandidates(options.organizationId, cursor),
    context: (planId: string): Promise<PlanEditContext> => port.context(options.organizationId, planId),
    start: (planId: string, mode: 'DIRECT' | 'GOVERNED', idempotencyKey: string): Promise<{ id: string }> => port.start(options.organizationId, planId, mode, idempotencyKey),
    add: (planId: string, editId: string, totalShares: number, asset: Omit<DataAsset, 'id'>): Promise<{ status: 'UPDATED' | 'RECOVERY_REQUIRED' }> => editor(planId, editId).addAsset({ organizationId: options.organizationId, planId, editId, totalShares, asset }),
    recover: (planId: string, editId: string): Promise<{ status: 'UPDATED' | 'RECOVERY_REQUIRED' }> => editor(planId, editId).recover({ organizationId: options.organizationId, planId, editId }),
    discard: (planId: string, editId: string): Promise<void> => editor(planId, editId).discard({ organizationId: options.organizationId, planId, editId }),
    discardLocal: (planId: string, editId = ''): Promise<void> => editor(planId, editId).discardLocal(planId),
  };
}
