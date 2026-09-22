import { createBrowserIntegrationCore } from '@safetech/inheriti-elements-core/browser';
import type { BrowserIntegrationCore } from '@safetech/inheriti-elements-core/browser';
import type { OperatorSessionStore } from '@safetech/inheriti-elements-core';
import type { ChromeConfiguration } from '../shared/configuration.js';
import { createChromeMasterKeySource } from './master-keys.js';
import { codeOf, type PanelState } from '../shared/plan-view.js';
import type { PlanAssetMetadata } from '../shared/messages.js';

/**
 * One composition point for the service worker, so no message handler builds its own client.
 *
 * `transport` exists so this exact composition — the real auth client, the real reveal facade, the
 * real custody — can be driven against a stubbed plan service without any of it being replaced. The
 * worker itself passes nothing and gets `fetch`.
 */
export function createCore(
  configuration: ChromeConfiguration,
  sessions: OperatorSessionStore,
  transport?: typeof fetch,
  organizationId?: string,
): BrowserIntegrationCore {
  return createBrowserIntegrationCore({
    ...(transport === undefined ? {} : { fetchImpl: transport }),
    apiUrl: configuration.apiUrl,
    environment: configuration.environment,
    liveConfirmation: configuration.environment,
    ...(configuration.applicationId === undefined
      ? { business: true as const, ...(organizationId === undefined ? {} : { organizationId }) }
      : { applicationId: configuration.applicationId }),
    // Declared, not composed: with a stored secret the worker derives the key itself; without one
    // the SDK asks the device holding it.
    ...(configuration.applicationId === undefined ? {} : { masterKey: { source: createChromeMasterKeySource(configuration) } }),
    // No `reconstruction.workerUrl`: an MV3 service worker has no `Worker` constructor, so one
    // could never be used. Reconstruction has no off-thread size ceiling — only splitting does,
    // and this host never splits.
    sessions,
    configuration: {
      issuer: configuration.issuer,
      clientId: configuration.clientId,
      audience: configuration.applicationId === undefined ? 'inheriti-integrations-api' : 'inheriti-elements-api',
      environment: configuration.environment,
      redirectUri: chrome.identity.getRedirectURL('integrations-oauth'),
      scopes: configuration.scopes,
    },
  });
}

export async function loadPlans(core: BrowserIntegrationCore): Promise<PanelState> {
  if (!(await core.getAccessToken())) return { kind: 'SIGNED_OUT' };
  try {
    const page = await core.listPlans({ assetType: 'USER-PSWD' });
    return page.items.length === 0
      ? { kind: 'EMPTY', reason: 'no-autofill-plans' }
      : { kind: 'PLANS', plans: page.items.map(summarise) };
  } catch (error) {
    return { kind: 'ERROR', code: codeOf(error) };
  }
}

export async function loadPlanAssets(core: BrowserIntegrationCore, planId: string): Promise<readonly PlanAssetMetadata[]> {
  const plan = await core.getPlan(planId);
  return plan.assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    type: compatibleValue(asset.type),
    isBinary: asset.isBinary,
    fieldNames: asset.fieldNames,
    ...(asset.fileName === undefined ? {} : { fileName: asset.fileName }),
    ...(asset.mimeType === undefined ? {} : { mimeType: asset.mimeType }),
    ...(asset.size === undefined ? {} : { size: asset.size }),
  }));
}

function compatibleValue(value: string | { kind: 'UNKNOWN'; raw: string }): string {
  return typeof value === 'string' ? value : value.raw;
}

function summarise(plan: { id: string; name: string; status: unknown }): { id: string; name: string; status: string } {
  const status = plan.status as string | { kind: 'UNKNOWN'; raw: string };
  return { id: plan.id, name: plan.name, status: typeof status === 'string' ? status : status.raw };
}
