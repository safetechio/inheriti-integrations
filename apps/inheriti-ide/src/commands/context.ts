import type * as vscode from 'vscode';
import type { BusinessOrganization, NodeIntegrationCore } from '@safetech/inheriti-elements-core/node';
import type { resolveConfiguration } from '../configuration.js';
import type { PlanViewState } from '../plan-view-model.js';
import type { ActiveRevealRegistry } from '../reveal.js';
import type { createIdeSafeKeyPro } from '../safekey-pro.js';
import type { SecretSessionStore } from '../session-store.js';

export interface CommandContext {
  context: vscode.ExtensionContext;
  sessions: SecretSessionStore;
  activeReveals: ActiveRevealRegistry;
  configuration(): ReturnType<typeof resolveConfiguration>;
  core(scoped?: boolean): NodeIntegrationCore;
  currentCore(): Promise<NodeIntegrationCore>;
  changeOrganization(next?: BusinessOrganization): Promise<number>;
  refresh(): Promise<void>;
  render(state: PlanViewState): void;
  revision(): number;
  keyOwner(): 'Application' | 'Organisation';
  safeKeyPro(): ReturnType<typeof createIdeSafeKeyPro>;
  pickCustodianDevice(signal?: AbortSignal): Promise<'SK_MOBILE' | 'SK_PRO' | undefined>;
}
