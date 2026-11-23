import { groupImportDiagnostics } from '@modules/import/domain/import-diagnostic';
import { getAssetFieldDisplayName } from '@modules/_shared/domain/asset-field-display-name';
import type { SourceCoverage } from '@modules/mapping/application/source-coverage';
import type { ReviewAsset } from './types';
import {
  assetSourceFieldRows,
  isCurrentDestination,
  sourceFieldDisplayName,
} from './source-field-coverage';

export function assetStatusForIssues(asset: ReviewAsset, issueCount: number): ReviewAsset['status'] {
  if (asset.status === 'accepted' || asset.status === 'excluded') return asset.status;
  if (issueCount > 0) return 'needs-review';
  return asset.status === 'needs-review' ? 'suggested' : asset.status;
}

export function getAssetIssueContext(
  asset: ReviewAsset,
  fields: SourceCoverage['fields'] | undefined,
  assets: ReviewAsset[],
) {
  const sourceFields =
    fields?.filter((field) =>
      asset.sourceNodeId
        ? field.nodeId === asset.sourceNodeId && field.sourceId === asset.sourceId
        : (!asset.sourceId || field.sourceId === asset.sourceId) &&
          field.destinations.some(({ assetId }) => isCurrentDestination(asset, assetId)),
    ) ?? [];
  const siblings =
    asset.sourceId && asset.sourceNodeId
      ? assets.filter(
          (item) =>
            item.id !== asset.id &&
            item.sourceId === asset.sourceId &&
            item.sourceNodeId === asset.sourceNodeId &&
            item.status !== 'excluded',
        )
      : [];
  return { sourceFields, siblings };
}

function addToGroup<T>(groups: Map<string, T[]>, key: string, item: T) {
  const group = groups.get(key);
  if (group) group.push(item);
  else groups.set(key, [item]);
}

const entryKey = (sourceId: string | undefined, nodeId: string | undefined) =>
  JSON.stringify([sourceId, nodeId]);

export function indexAssetReviewIssues(assets: ReviewAsset[], coverage?: SourceCoverage) {
  const assetsByEntry = new Map<string, ReviewAsset[]>();
  const fieldsByEntry = new Map<string, SourceCoverage['fields']>();
  const fieldsByDestination = new Map<string, SourceCoverage['fields']>();
  if (coverage) {
    for (const asset of assets) {
      if (asset.sourceNodeId && asset.status !== 'excluded')
        addToGroup(assetsByEntry, entryKey(asset.sourceId, asset.sourceNodeId), asset);
    }
    for (const field of coverage.fields) {
      addToGroup(fieldsByEntry, entryKey(field.sourceId, field.nodeId), field);
      for (const id of new Set(field.destinations.map(({ assetId }) => assetId)))
        addToGroup(fieldsByDestination, id, field);
    }
  }
  return (asset: ReviewAsset) => {
    const key = entryKey(asset.sourceId, asset.sourceNodeId);
    const fields = asset.sourceNodeId
      ? fieldsByEntry.get(key)
      : [
          ...new Set(
            [asset.id, ...(asset.destinationAssetIds ?? [])].flatMap(
              (id) => fieldsByDestination.get(id) ?? [],
            ),
          ),
        ];
    const { sourceFields, siblings } = getAssetIssueContext(
      asset,
      fields,
      assetsByEntry.get(key) ?? [],
    );
    return getAssetReviewIssues(asset, sourceFields, siblings, coverage ? [] : undefined);
  };
}

export function getAssetReviewIssues(
  asset: ReviewAsset,
  sourceFields: SourceCoverage['fields'],
  siblings: ReviewAsset[],
  sourceDiagnostics?: SourceCoverage['diagnostics'],
) {
  const review = asset.status !== 'excluded';
  const schema = asset.schemaFields ?? [];
  const bindingIssues = new Map<string, { message: string; sourceId?: string }>();
  const invalidFields = new Set<string>();
  if (review) {
    for (const field of schema) {
      const hasPlainText =
        field.key === 'secret.text' &&
        (asset.plainTextValue?.length || asset.plainTextSources?.length);
      if (field.validationError) {
        bindingIssues.set(field.key, {
          message: `${field.label} — ${field.validationError}`,
          sourceId: field.sourceFieldId,
        });
        if (field.sourceFieldId) invalidFields.add(field.sourceFieldId);
      } else if (field.required && !field.sourceFieldId && !hasPlainText) {
        bindingIssues.set(field.key, { message: `${field.label} — Required field is missing.` });
      }
    }
    for (const field of sourceFields) {
      for (const destination of field.destinations) {
        if (destination.valid !== false || !isCurrentDestination(asset, destination.assetId))
          continue;
        invalidFields.add(field.id);
        // Coverage can mark every reference invalid when a different required field is missing.
        if (schema.some(({ key }) => key === destination.fieldId)) continue;
        if (!bindingIssues.has(destination.fieldId)) {
          bindingIssues.set(destination.fieldId, {
            message: `${getAssetFieldDisplayName(destination.fieldId)} — Invalid mapping.`,
            sourceId: field.id,
          });
        }
      }
    }
    const protectedFields = schema.filter(({ key }) => key.startsWith('secret.'));
    if (
      !bindingIssues.size &&
      asset.type !== 'PLAIN-TEXT' &&
      protectedFields.length &&
      !protectedFields.some(({ sourceFieldId }) => sourceFieldId)
    )
      bindingIssues.set('missing', {
        message: 'Map at least one protected field before accepting this asset.',
      });
    if (invalidFields.size && !bindingIssues.size)
      bindingIssues.set('asset', {
        message: 'This asset needs a valid mapping before it can cover source fields.',
      });
  }
  const note = asset.note;
  const notesPending =
    review &&
    note &&
    !note.explicit &&
    !sourceFields.some(({ id, status }) => id === note.sourceFieldId && status === 'excluded');
  const unmappedIds =
    asset.unmappedSourceFieldIds === undefined ? undefined : new Set(asset.unmappedSourceFieldIds);
  const unresolved = !review
    ? []
    : sourceDiagnostics !== undefined || unmappedIds !== undefined
      ? assetSourceFieldRows(asset, sourceFields, siblings)
          .filter(
            ({ field, pending }) =>
              pending &&
              (unmappedIds === undefined || unmappedIds.has(field.id)) &&
              field.status === 'pending' &&
              field.id !== note?.sourceFieldId &&
              !invalidFields.has(field.id),
          )
          .map(({ field }) => ({
            id: field.id,
            name: sourceFieldDisplayName(field.name),
            reason: 'No destination is assigned.',
          }))
      : asset.unmapped.map((name, index) => ({
          id: String(index),
          name: sourceFieldDisplayName(name),
          reason: 'No destination is assigned.',
        }));
  const diagnostics = groupImportDiagnostics(
    asset.ownsSourceDiagnostics !== false && asset.sourceId && asset.sourceNodeId
      ? sourceDiagnostics?.filter(
          (diagnostic) =>
            diagnostic.sourceId === asset.sourceId && diagnostic.entryId === asset.sourceNodeId,
        )
      : undefined,
  );
  const fieldIssueIds = new Set(
    [...bindingIssues].map(([key, { sourceId }]) =>
      sourceId ? `source:${sourceId}` : `binding:${key}`,
    ),
  );
  if (notesPending) fieldIssueIds.add(`source:${note.sourceFieldId}`);
  for (const { id } of unresolved) fieldIssueIds.add(`source:${id}`);
  const issueCount = fieldIssueIds.size;
  return { schema, bindingIssues, note, notesPending, unresolved, diagnostics, issueCount };
}
