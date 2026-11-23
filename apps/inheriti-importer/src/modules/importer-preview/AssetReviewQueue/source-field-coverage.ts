import { getAssetFieldDisplayName } from '@modules/_shared/domain/asset-field-display-name';
import type { SourceCoverageField } from '@modules/mapping/application/source-coverage';
import type { ReviewAsset } from './types';

export const unassignedFieldsExplanation =
  'These fields are still available in this import. Choose where to store them or exclude them.';

export function sourceFieldDisplayName(name: string): string {
  return name.replace(/^extra:/i, '');
}

type Proposal = { label: string; invalid: boolean; assetName?: string };

export function isCurrentDestination(asset: ReviewAsset, destinationAssetId: string): boolean {
  return (
    asset.id === destinationAssetId ||
    Boolean(asset.destinationAssetIds?.includes(destinationAssetId))
  );
}

export function assetSourceFieldRows(
  asset: ReviewAsset,
  fields: SourceCoverageField[],
  siblings: ReviewAsset[] = [],
) {
  const proposals = new Map<string, Proposal[]>();
  const addProposal = (id: string, label: string, invalid = false) => {
    const prior = proposals.get(id) ?? [];
    proposals.set(id, [...prior, { label, invalid }]);
  };
  if (asset.status !== 'accepted' && asset.status !== 'excluded') {
    for (const field of asset.schemaFields ?? []) {
      if (field.sourceFieldId)
        addProposal(field.sourceFieldId, field.label, Boolean(field.validationError));
    }
    for (const field of asset.plainTextSources ?? []) addProposal(field.id, 'Text');
  }

  const elsewhere = new Map<string, Proposal[]>();
  for (const sibling of siblings) {
    if (sibling.status === 'accepted' || sibling.status === 'excluded') continue;
    const add = (id: string, label: string, invalid = false) =>
      elsewhere.set(id, [
        ...(elsewhere.get(id) ?? []),
        { label, invalid, assetName: sibling.name },
      ]);
    for (const field of sibling.schemaFields ?? []) {
      if (field.sourceFieldId)
        add(field.sourceFieldId, field.label, Boolean(field.validationError));
    }
    for (const field of sibling.plainTextSources ?? []) add(field.id, 'Text');
  }
  const unmapped = new Set(asset.unmappedSourceFieldIds);
  return fields.map((field) => {
    const uncovered = field.status === 'pending' || field.status === 'invalid';
    const covered = field.status === 'mapped' || field.status === 'protected';
    const mappedHere =
      covered &&
      field.destinations.some(
        (destination) =>
          destination.valid !== false && isCurrentDestination(asset, destination.assetId),
      );
    const coveredElsewhere =
      covered &&
      field.destinations.some(
        (destination) =>
          destination.valid !== false && !isCurrentDestination(asset, destination.assetId),
      );
    const proposed =
      field.status !== 'excluded' && !mappedHere ? (proposals.get(field.id) ?? []) : [];
    const proposedElsewhere =
      field.status === 'excluded' || coveredElsewhere ? [] : (elsewhere.get(field.id) ?? []);
    const pending =
      uncovered &&
      !proposedElsewhere.some(({ invalid }) => !invalid) &&
      (proposed.length === 0 ||
        proposed.some(({ invalid }) => invalid) ||
        field.status === 'invalid');
    return {
      field,
      actionable:
        asset.status !== 'excluded' && uncovered && !proposed.length && unmapped.has(field.id),
      pending,
      mappedHere,
      coveredElsewhere,
      proposed,
      proposedElsewhere,
    };
  });
}

export function describeField(
  { field, proposed, proposedElsewhere }: ReturnType<typeof assetSourceFieldRows>[number],
  asset: ReviewAsset,
): string[] {
  const proposedDescriptions = [
    ...proposed.map(({ label, invalid }) =>
      invalid ? `Invalid proposed mapping · ${label}` : `Proposed mapping · ${label}`,
    ),
    ...proposedElsewhere.map(
      ({ label, invalid, assetName }) =>
        `${invalid ? 'Invalid proposal' : 'Proposed'} in ${assetName} · ${label}`,
    ),
  ];
  if (field.status === 'excluded') return ['Explicitly excluded from import'];
  if (field.status === 'pending')
    return proposedDescriptions.length
      ? [...new Set(proposedDescriptions)]
      : ['Pending a destination'];
  if (field.status === 'invalid')
    return [...proposedDescriptions, 'Invalid destination — review required'];
  return [
    ...proposedDescriptions,
    ...new Set(
      field.destinations.map((destination) => {
        if (destination.valid === false) {
          const scope = isCurrentDestination(asset, destination.assetId)
            ? 'This asset'
            : 'Additional asset';
          return `Invalid destination · ${scope} · ${getAssetFieldDisplayName(destination.fieldId)}`;
        }
        if (!isCurrentDestination(asset, destination.assetId))
          return 'Preserved in an additional asset · Mapped';
        return `Mapped · This asset · ${getAssetFieldDisplayName(destination.fieldId)}`;
      }),
    ),
  ];
}

export function selectableSourceFields(
  asset: ReviewAsset,
  rows: ReturnType<typeof assetSourceFieldRows>,
  siblings: ReviewAsset[],
): SourceCoverageField[] {
  const literal = asset.type === 'PLAIN-TEXT' && Boolean(asset.plainTextValue);
  const otherStructuredIds = new Set(
    siblings
      .filter(({ type }) => type !== 'PLAIN-TEXT')
      .flatMap(({ schemaFields }) => schemaFields?.map(({ sourceFieldId }) => sourceFieldId) ?? []),
  );
  return rows
    .filter(({ field, actionable, proposedElsewhere, coveredElsewhere }) => {
      if (literal || asset.status === 'excluded' || !asset.sourceNodeId || !asset.sourceId)
        return false;
      if (field.status === 'excluded' || field.status === 'invalid') return false;
      if (field.sourceId !== asset.sourceId || field.nodeId !== asset.sourceNodeId) return false;
      const structuredBinding =
        asset.type !== 'PLAIN-TEXT' &&
        asset.schemaFields?.some(({ sourceFieldId }) => sourceFieldId === field.id);
      if (structuredBinding || asset.note?.sourceFieldId === field.id) return false;
      if (otherStructuredIds.has(field.id)) return false;
      if (actionable && !proposedElsewhere.length && !coveredElsewhere) return true;
      if (field.destinations.some(({ fieldId }) => fieldId !== 'secret.text')) return false;
      return (
        asset.type === 'PLAIN-TEXT' &&
        (asset.plainTextSources?.some(({ id }) => id === field.id) ||
          asset.schemaFields?.some(
            ({ key, sourceFieldId }) => key === 'secret.text' && sourceFieldId === field.id,
          ))
      );
    })
    .map(({ field }) => field);
}
