import type { ImportCoverage, ReviewAsset } from './types';

export function isUndecided(asset: ReviewAsset): boolean {
  return asset.status !== 'accepted' && asset.status !== 'excluded';
}

export function isNoteDestinationPending(
  asset: ReviewAsset,
  excludedFieldIds: ReadonlySet<string>,
): asset is ReviewAsset & { note: NonNullable<ReviewAsset['note']> } {
  return Boolean(
    asset.note && !asset.note.explicit && !excludedFieldIds.has(asset.note.sourceFieldId),
  );
}

export function getReviewBlockers(assets: ReviewAsset[], coverage?: ImportCoverage) {
  const fields = coverage?.fields ?? [];
  const excluded = new Set(
    fields.filter(({ status }) => status === 'excluded').map(({ id }) => id),
  );
  const pendingNotes = new Set<string>();
  const proposed = new Set<string>();
  let undecidedCount = 0;
  for (const asset of assets) {
    if (isUndecided(asset)) undecidedCount++;
    if ((coverage || asset.status !== 'excluded') && isNoteDestinationPending(asset, excluded))
      pendingNotes.add(asset.note.sourceFieldId);
    if (asset.status === 'excluded') continue;
    for (const { sourceFieldId, validationError } of asset.schemaFields ?? []) {
      if (sourceFieldId && !validationError) proposed.add(sourceFieldId);
    }
    if (!asset.schemaFields?.some(({ validationError }) => validationError)) {
      for (const { id } of asset.plainTextSources ?? []) proposed.add(id);
    }
  }
  return {
    pendingFieldCount: fields.filter(
      ({ id, status }) => status === 'pending' && !pendingNotes.has(id) && !proposed.has(id),
    ).length,
    invalidFieldCount: fields.filter(({ status }) => status === 'invalid').length,
    pendingNoteCount: pendingNotes.size,
    undecidedCount,
  };
}
