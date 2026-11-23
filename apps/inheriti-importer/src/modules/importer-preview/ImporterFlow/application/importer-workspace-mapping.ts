import { SensitiveValue } from '@modules/import/domain/import-model';
import { getPlanAssetFormFields } from '@modules/plans/domain/asset-metadata';
import type { ReviewAsset } from '../../AssetReviewQueue/types';
import type { ImporterWorkspaceContext } from './use-importer-workspace';
import { nativeNotes } from './importer-workspace-notes';
import { reconcileEditedBindings } from './importer-workspace-companion';
import { mappedFieldIds, statusKey } from './importer-workspace-suggestions';

export function createMappingActions(context: ImporterWorkspaceContext) {
  const {
    session,
    mappingOverrides,
    plainTextOverrides,
    setPlainTextOverrides,
    setMappingOverrides,
    setDecisions,
    updateWorkspace,
    byId,
  } = context;

  function mapAssetField(asset: ReviewAsset, targetField: string, sourceFieldId?: string) {
    const suggestion = byId(asset.id);
    if (
      !suggestion ||
      suggestion.variant === 'rescued-fields' ||
      !getPlanAssetFormFields(suggestion.type).some((field) => field.source === targetField) ||
      (!targetField.startsWith('secret.') && targetField !== 'meta.notes')
    )
      return;
    if (
      targetField === 'meta.notes' &&
      sourceFieldId &&
      nativeNotes(session, suggestion.fromNodeId)?.id === sourceFieldId
    )
      return;
    if (sourceFieldId) {
      const projectedField = context.projection.assets
        .find((candidate) => candidate.id === asset.id)
        ?.schemaFields?.find(({ key }) => key === targetField);
      if (!projectedField?.candidates?.some(({ id }) => id === sourceFieldId)) return;
    }

    const nextOrganization =
      context.organization.assets[asset.id] && sourceFieldId
        ? {
            ...context.organization,
            owners: { ...context.organization.owners, [sourceFieldId]: asset.id },
          }
        : context.organization;
    if (nextOrganization !== context.organization) {
      if (
        nativeNotes(session, suggestion.fromNodeId)?.id === sourceFieldId ||
        context.projection.suggestions.some(
          (other) =>
            statusKey(other) !== asset.id &&
            other.fromNodeId === suggestion.fromNodeId &&
            other.type !== 'PLAIN-TEXT' &&
            mappedFieldIds(other).has(sourceFieldId!),
        )
      )
        return;
      context.setOrganization(nextOrganization);
    }

    const isPlainTextValue = suggestion.type === 'PLAIN-TEXT' && targetField === 'secret.text';
    const edits = { ...mappingOverrides[asset.id], [targetField]: sourceFieldId };
    if (isPlainTextValue && !sourceFieldId) delete edits[targetField];
    const nextMappings = { ...mappingOverrides, [asset.id]: edits };
    const nextPlainText = { ...plainTextOverrides };
    if (isPlainTextValue) {
      plainTextOverrides[asset.id]?.clear();
      delete nextPlainText[asset.id];
      setPlainTextOverrides(nextPlainText);
    }
    if (!Object.keys(edits).length) delete nextMappings[asset.id];
    setMappingOverrides(nextMappings);
    setDecisions((current) =>
      current[asset.id] === 'excluded' ? current : { ...current, [asset.id]: 'needs-review' },
    );
    updateWorkspace((current) =>
      reconcileEditedBindings(
        { ...context, organization: nextOrganization },
        current,
        suggestion.fromNodeId,
        asset.id,
        targetField,
        nextMappings,
        nextPlainText,
      ),
    );
  }

  function editPlainText(asset: ReviewAsset, value: string) {
    const suggestion = byId(asset.id);
    if (!suggestion || suggestion.type !== 'PLAIN-TEXT' || suggestion.variant === 'rescued-fields')
      return;
    plainTextOverrides[asset.id]?.clear();
    const nextPlainText = { ...plainTextOverrides, [asset.id]: new SensitiveValue(value) };
    setPlainTextOverrides(nextPlainText);
    setDecisions((current) =>
      current[asset.id] === 'excluded' ? current : { ...current, [asset.id]: 'needs-review' },
    );
    updateWorkspace((current) =>
      reconcileEditedBindings(
        context,
        current,
        suggestion.fromNodeId,
        asset.id,
        'secret.text',
        mappingOverrides,
        nextPlainText,
      ),
    );
  }

  return { mapAssetField, editPlainText };
}
