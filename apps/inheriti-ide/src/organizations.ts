import type { Memento } from 'vscode';
import type { NodeIntegrationCore, BusinessOrganization } from '@safetech/inheriti-elements-core/node';
import type { OperatorSessionStore } from '@safetech/inheriti-elements-core';
import type { ExtensionConfiguration } from './configuration.js';

const KEY = 'inheriti.businessOrganizations';

async function selectionKey(core: NodeIntegrationCore, sessions: OperatorSessionStore, configuration: ExtensionConfiguration): Promise<string | undefined> {
  if (!(await core.getAccessToken())) return undefined;
  const subject = (await sessions.load())?.principal.subject;
  return subject ? JSON.stringify([configuration.issuer, configuration.environment, subject]) : undefined;
}

export async function discoverOrganizations(
  core: NodeIntegrationCore, sessions: OperatorSessionStore, state: Memento, configuration: ExtensionConfiguration,
): Promise<{ items: BusinessOrganization[]; selected?: BusinessOrganization; signedOut?: boolean }> {
  const key = await selectionKey(core, sessions, configuration);
  if (!key) return { items: [], signedOut: true };
  const items = await core.listOrganizations();
  const saved = state.get<Record<string, string>>(KEY, {});
  const selected = items.find(({ id }) => id === saved[key]);
  if (selected) return { items, selected };
  if (saved[key]) { delete saved[key]; await state.update(KEY, saved); }
  if (items.length === 1) {
    saved[key] = items[0]!.id;
    await state.update(KEY, saved);
    return { items, selected: items[0] };
  }
  return { items };
}

export async function saveOrganization(
  core: NodeIntegrationCore, sessions: OperatorSessionStore, state: Memento,
  configuration: ExtensionConfiguration, organizationId: string,
): Promise<BusinessOrganization> {
  const key = await selectionKey(core, sessions, configuration);
  if (!key) throw Object.assign(new Error('operator_not_signed_in'), { code: 'operator_not_signed_in' });
  const organization = (await core.listOrganizations()).find(({ id }) => id === organizationId);
  if (!organization) throw Object.assign(new Error('organization_access_denied'), { code: 'organization_access_denied' });
  await state.update(KEY, { ...state.get<Record<string, string>>(KEY, {}), [key]: organizationId });
  return organization;
}
