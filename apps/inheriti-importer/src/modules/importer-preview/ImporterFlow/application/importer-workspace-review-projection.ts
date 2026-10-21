import {
  getPlanAssetFormFields,
  validateAssetEditorValues,
} from '@modules/plans/domain/asset-metadata';
import type { ImportSession } from '@modules/import/domain/import-model';
import { suggestedAssetToDraft } from '@modules/mapping/application/suggestion-engine';
import type { SuggestedAsset } from '@modules/mapping/domain/suggestion';
import type { WorkspaceState } from '@modules/plans/domain/workspace-model';
import { listPlanDrafts } from '@modules/plans/domain/workspace-selectors';
import { getAssetFieldDisplayName } from '@modules/_shared/domain/asset-field-display-name';
import { materialiseAsset } from '@modules/plans/domain/asset-materializer';
import type { AssetReviewStatus, ReviewAsset } from '../../AssetReviewQueue/types';
import {
  statusKey,
  suggestionFields,
  mappedFieldIds,
  assetMatchesSuggestion,
} from './importer-workspace-suggestions';

/** Include schema and materialisation errors in the review row. */
function suggestionValidationErrors(
  session: ImportSession,
  suggestion: SuggestedAsset,
): Record<string, string> {
  const draft = suggestedAssetToDraft(suggestion, crypto.randomUUID());
  const materialised = materialiseAsset(draft, session);
  const errors = validateAssetEditorValues(suggestion.type, {
    meta: materialised.asset.meta,
    secret: materialised.asset.secret,
  });
  for (const error of materialised.errors) errors[error.assetFieldSource] = error.message;
  return errors;
}

/** Preserve explicit decisions before inferring status from assignment. */
export function reviewStatus(
  session: ImportSession,
  suggestion: SuggestedAsset,
  workspace: WorkspaceState,
  decisions: Record<string, AssetReviewStatus>,
): AssetReviewStatus {
  const key = statusKey(suggestion);
  if (decisions[key]) return decisions[key];
  const assigned = listPlanDrafts(workspace).some((plan) =>
    plan.assets.some((asset) => assetMatchesSuggestion(session, asset, suggestion)),
  );
  if (assigned) return 'accepted';
  if (suggestion.type === 'PLAIN-TEXT' || suggestion.confidence === 0) return 'fallback';
  return suggestion.confidence >= 0.75 ? 'suggested' : 'needs-review';
}

// Keep review labels and validation aligned with the staged suggestions.
export function projectAssets(
  session: ImportSession,
  suggestions: SuggestedAsset[],
  workspace: WorkspaceState,
  decisions: Record<string, AssetReviewStatus>,
  plainTextAssetIds: ReadonlySet<string>,
): ReviewAsset[] {
  return suggestions.map((suggestion): ReviewAsset => {
    const fields = suggestionFields(session, suggestion);
    const mappedIds = mappedFieldIds(suggestion);
    const mapped = fields.filter((field) => mappedIds.has(field.id)).map((field) => field.name);
    const unmapped =
      suggestion.variant === 'additional-fields' &&
      suggestions.some(
        (candidate) =>
          candidate.fromNodeId === suggestion.fromNodeId && candidate.type !== 'PLAIN-TEXT',
      )
        ? []
        : fields.filter((field) => !mappedIds.has(field.id)).map((field) => field.name);
    const validationErrors = suggestionValidationErrors(session, suggestion);
    const projectedStatus = reviewStatus(session, suggestion, workspace, decisions);
    const status =
      Object.keys(validationErrors).length > 0 &&
      !['accepted', 'excluded'].includes(projectedStatus)
        ? 'needs-review'
        : projectedStatus;
    const schemaFields = getPlanAssetFormFields(suggestion.type)
      .filter((field) => field.source.startsWith('secret.') || field.source === 'meta.notes')
      .map((field) => {
        const binding = suggestion.fieldBindings[field.source];
        const candidates = fields.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          length: candidate.value.length,
        }));
        return {
          key: field.source,
          label: getAssetFieldDisplayName(field.source),
          sourceFieldId: binding?.kind === 'source' ? binding.sourceFieldId : undefined,
          sourceFieldName:
            binding?.kind === 'source'
              ? fields.find((item) => item.id === binding.sourceFieldId)?.name
              : undefined,
          candidates,
          validationError: validationErrors[field.source],
        };
      });
    return {
      id: statusKey(suggestion),
      name: suggestion.name,
      type: suggestion.type,
      status,
      suggestionLabel:
        suggestion.type === 'PLAIN-TEXT'
          ? 'Plain Text fallback'
          : `Suggested ${
              suggestion.type === 'USER-PSWD'
                ? 'Username and Password'
                : suggestion.type === 'PAYMENT-CREDIT-CARD'
                  ? 'Credit Card'
                  : 'API Key'
            }`,
      rationale: suggestion.rationale,
      mapped,
      unmapped,
      source: fields[0]
        ? `${session.sources.find((source) => source.id === fields[0].sourceId)?.fileName ?? 'Imported source'} · ${suggestion.name}`
        : 'Imported source',
      alternatives: suggestion.type === 'PLAIN-TEXT' ? [] : ['PLAIN-TEXT'],
      previewFields: mapped,
      schemaFields,
      plainTextValue:
        suggestion.fieldBindings['secret.text']?.kind === 'literal'
          ? suggestion.fieldBindings['secret.text'].value
          : undefined,
      plainTextSources:
        suggestion.fieldBindings['secret.text']?.kind === 'sources'
          ? suggestion.fieldBindings['secret.text'].sources.map((source) => ({
              id: source.sourceFieldId,
              name: source.name,
              length: session.fieldsById[source.sourceFieldId]?.value.length,
            }))
          : undefined,
      convertedFromType: (suggestion.variant === 'additional-fields' ? [] : [...plainTextAssetIds])
        .find((id) => id.slice(0, id.lastIndexOf(':')) === suggestion.fromNodeId)
        ?.slice(suggestion.fromNodeId.length + 1),
    };
  });
}
