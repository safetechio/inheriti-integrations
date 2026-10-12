import type { SensitiveValue } from '@modules/import/domain/import-model';

/**
 * The mapping workspace state. Bindings reference source field ids
 * rather than copying secret values into multiple stores; a selector
 * materialises `DataAsset[]` only for validation / configuration.
 */

export type PlanDraftType = 'BACKUP';

export interface FieldBindingSource {
  kind: 'source';
  sourceFieldId: string;
}

export interface FieldBindingLiteral {
  kind: 'literal';
  value: SensitiveValue;
}

export interface FieldBindingSources {
  kind: 'sources';
  sources: Array<{ sourceFieldId: string; name: string }>;
}

export type FieldBinding = FieldBindingSource | FieldBindingLiteral | FieldBindingSources;

export interface AssetDraft {
  id: string;
  /** A Core `DataAssetType` id, e.g. `'USER-PSWD'`. */
  type: string;
  name: string;
  /** Asset-field source path -> binding. */
  fieldBindings: Record<string, FieldBinding>;
}

export interface GovernanceDraft {
  sharingModel: 'SHARED' | 'PRIVATE';
  moderatedAccess: boolean;
  extraModeratorIds: string[];
  authenticationMethodIds: string[];
  authenticationMode?: 'EXCLUSIVE' | 'ALL_REQUIRED';
  approvalMode?: 'THRESHOLD' | 'UNANIMOUS';
  requestedMinimumApprovals?: number;
}

export interface PlanDraft {
  clientId: string;
  type: PlanDraftType;
  name: string;
  description?: string;
  categoryId: string | null;
  teamIds: string[];
  assets: AssetDraft[];
  governance: GovernanceDraft;
}

export type PlanDraftStatus = 'EDITING' | 'VALID' | 'INVALID';

export interface WorkspaceState {
  /** Plan drafts in display order. */
  planOrder: string[];
  plansByClientId: Record<string, PlanDraft>;
  /** Source field ids the user explicitly excluded from mapping. */
  ignoredSourceFieldIds: string[];
  /** A monotonic revision, bumped on every command; a new revision after
   *  cancel/completion so returning to edit is a fresh pass. */
  revision: number;
}

export function createEmptyWorkspace(): WorkspaceState {
  return { planOrder: [], plansByClientId: {}, ignoredSourceFieldIds: [], revision: 0 };
}

export function defaultGovernance(): GovernanceDraft {
  return {
    sharingModel: 'SHARED',
    moderatedAccess: false,
    extraModeratorIds: [],
    authenticationMethodIds: [],
  };
}

export function makePlanDraft(clientId: string, name: string): PlanDraft {
  return {
    clientId,
    type: 'BACKUP',
    name,
    categoryId: null,
    teamIds: [],
    assets: [],
    governance: defaultGovernance(),
  };
}
