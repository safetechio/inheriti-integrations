import { createMasterKeyResolver, createNodeQuickPlanCreator, HttpElementsApiPort, HttpQuickPlanPort } from '@safetech/inheriti-client-sdk/node';
import { DataAssetDefinitionService } from '@safetech/inheriti-core-sdk/node';
import type { QuickPlanCreateContext, QuickPlanInput } from '@safetech/inheriti-client-sdk/node';

export const quickPlanAssetCatalog = (new DataAssetDefinitionService().getCoreDefinitions() as { id: string; category: string; fields: string[] }[])
  .map(({ id, category, fields }: { id: string; category: string; fields: string[] }) => ({ id, category, fields }));

export function createQuickPlanOperations(options: {
  apiUrl: string;
  environment: 'TEST' | 'LIVE';
  organizationId: string;
  getBearerToken: () => Promise<string | undefined>;
  acquireKey?: (signal: AbortSignal, onRelaySession: () => void) => Promise<string>;
  fetchImpl?: typeof fetch;
}) {
  const transport = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const bearer = async () => (await options.getBearerToken()) ?? null;
  const port = new HttpQuickPlanPort(options.apiUrl, options.environment, bearer, transport);
  const keyResolver = createMasterKeyResolver({
    api: new HttpElementsApiPort(options.apiUrl, options.environment, bearer, transport, { organizationId: options.organizationId }),
    organizationId: options.organizationId,
  });
  const creator = createNodeQuickPlanCreator({
    apiUrl: options.apiUrl,
    environment: options.environment,
    getBearerToken: bearer,
    transport,
  });
  return {
    createContext: () => port.createContext(options.organizationId),
    teams: () => port.teams(options.organizationId),
    acquireKey: (signal: AbortSignal, onRelaySession: () => void) => options.acquireKey ? options.acquireKey(signal, onRelaySession) : keyResolver.resolve(
      { system: 'INHERITI_BUSINESS', contextId: options.organizationId }, signal, onRelaySession,
    ),
    create: (input: { context: QuickPlanCreateContext; title: string; asset: QuickPlanInput['asset']; teamId?: string; masterKeySource: NonNullable<QuickPlanInput['masterKeySource']> }, onProgress?: Parameters<typeof creator.createQuickPlan>[1]) => creator.createQuickPlan({
      organizationId: options.organizationId,
      planId: input.context.planId,
      title: input.title,
      asset: input.asset,
      totalShares: input.context.storage.activeDataStorageLayerCount,
      masterKeySource: input.masterKeySource,
      ...(input.teamId ? { audience: { teamId: input.teamId } } : {}),
    }, onProgress),
    abandon: (planId: string) => creator.abandon(planId),
  };
}
