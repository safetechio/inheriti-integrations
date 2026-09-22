import type { AccessBatch, AccessBatchIdentity, FieldMapping, PageFieldTarget, ProtectedFieldRef } from '../shared/access-contract.js';

export interface PendingTabContext {
  readonly tabId: number;
  readonly origin: string;
}

export interface PendingAccessDraft {
  readonly identity: AccessBatchIdentity;
  readonly protectedFields: readonly ProtectedFieldRef[];
  readonly pageTargets: readonly PageFieldTarget[];
  readonly mappings: readonly FieldMapping[];
}

export class PendingTabContextStore {
  private context: PendingTabContext | undefined;
  private draft: PendingAccessDraft | undefined;

  public set(tabId: number, url: string): PendingTabContext | undefined {
    const origin = webOrigin(url);
    this.draft = undefined;
    this.context = origin === undefined ? undefined : { tabId, origin };
    return this.context;
  }

  public get(tabId: number): PendingTabContext | undefined {
    return this.context?.tabId === tabId ? this.context : undefined;
  }

  public invalidateTab(tabId: number): void {
    if (this.context?.tabId === tabId) this.context = undefined;
    if (this.draft?.identity.tabId === tabId) this.draft = undefined;
  }

  public invalidateForNavigation(tabId: number, url: string): void {
    const current = this.get(tabId);
    if (current !== undefined && current.origin !== webOrigin(url)) this.context = undefined;
    if (this.draft?.identity.tabId === tabId) this.draft = undefined;
  }

  public invalidateForTabChange(activeTabId: number): void {
    if (this.context !== undefined && this.context.tabId !== activeTabId) this.context = undefined;
    if (this.draft !== undefined && this.draft.identity.tabId !== activeTabId) this.draft = undefined;
  }

  public setDraft(draft: PendingAccessDraft): void { this.draft = draft; }

  public getDraft(tabId: number): PendingAccessDraft | undefined {
    return this.draft?.identity.tabId === tabId ? this.draft : undefined;
  }

  public updateMappings(tabId: number, mappings: readonly FieldMapping[]): AccessBatch | undefined {
    const draft = this.getDraft(tabId);
    if (draft === undefined) return undefined;
    this.draft = { ...draft, mappings };
    return { identity: draft.identity, mappings };
  }

  public clearDraft(): void { this.draft = undefined; }
}

function webOrigin(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}
