import type { ImportSession, SensitiveValue } from '@modules/import/domain/import-model';

/** A suggestion is a proposal that requires explicit user confirmation. */

export type SuggestedFieldBinding =
  | { kind: 'source'; sourceFieldId: string }
  | { kind: 'literal'; value: SensitiveValue }
  | { kind: 'sources'; sources: Array<{ sourceFieldId: string; name: string }> };

export interface SuggestedAsset {
  /** Core `DataAssetType` id. */
  type: string;
  name: string;
  /** asset field source -> binding */
  fieldBindings: Record<string, SuggestedFieldBinding>;
  /** Source node the suggestion was derived from. */
  fromNodeId: string;
  /** 0..1 — how confident the strategy is. */
  confidence: number;
  /** Why this was suggested, for the preview. */
  rationale: string;
}

export interface SuggestionResult {
  strategyId: string;
  assets: SuggestedAsset[];
}

export interface SuggestionContext {
  session: ImportSession;
  /** Nodes to consider — typically the dropped group/entry and its descendants. */
  nodeIds: string[];
  /** Valid Core asset type ids, from `DataAssetDefinitionService`. */
  knownAssetTypes: ReadonlySet<string>;
}

export interface SuggestionStrategy {
  id: string;
  suggest(context: SuggestionContext): SuggestionResult;
}
