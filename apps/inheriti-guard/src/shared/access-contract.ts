export type ProtectedFieldSemantic = 'username' | 'email' | 'password';

export interface AccessBatchIdentity {
  readonly planId: string;
  readonly tabId: number;
  readonly frameId: number;
  readonly origin: string;
  readonly navigationId: string;
}

export interface ProtectedFieldRef {
  readonly planId: string;
  readonly assetId: string;
  readonly assetCode: string;
  readonly assetName: string;
  readonly assetType: string;
  readonly fieldName: ProtectedFieldSemantic;
  readonly selector: string;
  readonly matchesOrigin: boolean;
}

export interface PageFieldTarget {
  readonly targetId: string;
  readonly tabId: number;
  readonly frameId: number;
  readonly origin: string;
  readonly navigationId: string;
  readonly semantic: ProtectedFieldSemantic;
  readonly label: string;
}

export interface FieldMapping {
  readonly protectedField: ProtectedFieldRef;
  readonly pageTarget: PageFieldTarget;
  readonly source: 'SUGGESTED' | 'MANUAL' | 'CONTEXT_MENU';
}

export type AccessSuggestionConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type AccessSuggestionReason =
  | 'exact-origin'
  | 'autocomplete'
  | 'input-type'
  | 'accessible-label'
  | 'name'
  | 'id'
  | 'inferred-semantic';

/** Metadata-only presentation details for a deterministic suggested mapping. */
export interface AccessFieldSuggestion {
  readonly mapping: FieldMapping;
  readonly confidence: AccessSuggestionConfidence;
  readonly reason: AccessSuggestionReason;
}

/** A metadata-only protected-field option offered after the operator selects a page field. */
export interface PageFirstFieldCandidate {
  readonly planName: string;
  readonly assetFieldNames: readonly ProtectedFieldSemantic[];
  readonly suggestion: AccessFieldSuggestion;
}

export interface AccessBatch {
  readonly identity: AccessBatchIdentity;
  readonly mappings: readonly FieldMapping[];
}

export type AccessBatchInvalidReason =
  | 'empty-batch'
  | 'mixed-plan'
  | 'mixed-page'
  | 'duplicate-protected-field'
  | 'duplicate-page-target';

export type AccessBatchValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: AccessBatchInvalidReason };

export function validateAccessBatch(batch: AccessBatch): AccessBatchValidation {
  if (batch.mappings.length === 0) return { valid: false, reason: 'empty-batch' };

  const protectedSelectors = new Set<string>();
  const pageTargets = new Set<string>();
  for (const mapping of batch.mappings) {
    if (mapping.protectedField.planId !== batch.identity.planId) {
      return { valid: false, reason: 'mixed-plan' };
    }
    if (!samePage(mapping.pageTarget, batch.identity)) {
      return { valid: false, reason: 'mixed-page' };
    }
    if (protectedSelectors.has(mapping.protectedField.selector)) {
      return { valid: false, reason: 'duplicate-protected-field' };
    }
    if (pageTargets.has(mapping.pageTarget.targetId)) {
      return { valid: false, reason: 'duplicate-page-target' };
    }
    protectedSelectors.add(mapping.protectedField.selector);
    pageTargets.add(mapping.pageTarget.targetId);
  }
  return { valid: true };
}

function samePage(target: PageFieldTarget, identity: AccessBatchIdentity): boolean {
  return target.tabId === identity.tabId
    && target.frameId === identity.frameId
    && target.origin === identity.origin
    && target.navigationId === identity.navigationId;
}

export type AccessFieldResultCode =
  | 'filled'
  | 'authorization-denied'
  | 'field-unavailable'
  | 'invalid-value'
  | 'stale-page-context'
  | 'destination-failed'
  | 'canceled'
  | 'not-attempted';

export interface AccessFieldResult {
  readonly selector: string;
  readonly targetId: string;
  readonly code: AccessFieldResultCode;
}
