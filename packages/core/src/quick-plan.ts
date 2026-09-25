import { createNodeQuickPlanCreator, HttpQuickPlanPort } from '@safetech/inheriti-client-sdk/node';
import { DataAssetDefinitionService } from '@safetech/inheriti-core-sdk/node';
import type { QuickPlanCreateContext, QuickPlanInput } from '@safetech/inheriti-client-sdk/node';

export const quickPlanAssetCatalog = new DataAssetDefinitionService().getCoreDefinitions()
  .map(({ id, category, fields }) => ({ id, category, fields }));

export function createQuickPlanOperations(options: {
  apiUrl: string;
  environment: 'TEST' | 'LIVE';
  organizationId: string;
  getBearerToken: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
}) {
  const transport = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const bearer = async () => (await options.getBearerToken()) ?? null;
  const port = new HttpQuickPlanPort(options.apiUrl, options.environment, bearer, transport);
  const creator = createNodeQuickPlanCreator({
    apiUrl: options.apiUrl,
    environment: options.environment,
    getBearerToken: bearer,
    transport,
  });
  return {
    createContext: () => port.createContext(options.organizationId),
    teams: () => port.teams(options.organizationId),
    create: (input: { context: QuickPlanCreateContext; title: string; asset: QuickPlanInput['asset']; teamId?: string }) => creator.createQuickPlan({
      organizationId: options.organizationId,
      planId: input.context.planId,
      title: input.title,
      asset: input.asset,
      totalShares: input.context.storage.activeDataStorageLayerCount,
      ...(input.teamId ? { audience: { teamId: input.teamId } } : {}),
    }),
    abandon: (planId: string) => creator.abandon(planId),
  };
}
