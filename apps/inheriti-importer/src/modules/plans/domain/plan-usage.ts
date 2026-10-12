import type { MaterialisedAsset } from '@modules/plans/domain/asset-materializer';

/**
 * Independent per-Plan usage. The aggregate metric — Σ field chars +
 * Σ file count + Σ file bytes across a Plan's assets — mirrors the SDK's
 * `asset-usage-calculator`. Limits are an explicit input (they are UI
 * defaults, not authority); the host supplies them from subscription /
 * storage config.
 */
export interface PlanUsageLimits {
  maxChars: number;
  maxFiles: number;
  maxFileBytes: number;
}

export interface PlanUsage {
  chars: number;
  files: number;
  fileBytes: number;
  withinLimits: boolean;
  overBy: Partial<Record<'chars' | 'files' | 'fileBytes', number>>;
}

function walk(value: unknown, acc: { chars: number; files: number; fileBytes: number }): void {
  if (typeof value === 'string') {
    acc.chars += value.length;
    return;
  }
  if (typeof value === 'number') {
    acc.chars += String(value).length;
    return;
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    acc.files += 1;
    acc.fileBytes += value.size;
    return;
  }
  if (
    value &&
    typeof value === 'object' &&
    'fileSize' in value &&
    typeof (value as { fileSize: unknown }).fileSize === 'number'
  ) {
    acc.files += 1;
    acc.fileBytes += (value as { fileSize: number }).fileSize;
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v) => walk(v, acc));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => walk(v, acc));
  }
}

export function calculatePlanUsage(
  assets: readonly MaterialisedAsset[],
  limits: PlanUsageLimits,
): PlanUsage {
  const acc = { chars: 0, files: 0, fileBytes: 0 };
  for (const asset of assets) walk(asset.secret, acc);

  const overBy: PlanUsage['overBy'] = {};
  if (acc.chars > limits.maxChars) overBy.chars = acc.chars - limits.maxChars;
  if (acc.files > limits.maxFiles) overBy.files = acc.files - limits.maxFiles;
  if (acc.fileBytes > limits.maxFileBytes) overBy.fileBytes = acc.fileBytes - limits.maxFileBytes;

  return {
    chars: acc.chars,
    files: acc.files,
    fileBytes: acc.fileBytes,
    withinLimits: Object.keys(overBy).length === 0,
    overBy,
  };
}

/**
 * Preview the usage change of moving one asset from `fromAssets` to
 * `toAssets` — computes the delta for both the source and destination Plan.
 */
export function previewAssetMove(input: {
  asset: MaterialisedAsset;
  fromAssets: readonly MaterialisedAsset[];
  toAssets: readonly MaterialisedAsset[];
  limits: PlanUsageLimits;
}): { from: { before: PlanUsage; after: PlanUsage }; to: { before: PlanUsage; after: PlanUsage } } {
  const fromBefore = calculatePlanUsage(input.fromAssets, input.limits);
  const fromAfter = calculatePlanUsage(
    input.fromAssets.filter((a) => a.id !== input.asset.id),
    input.limits,
  );
  const toBefore = calculatePlanUsage(input.toAssets, input.limits);
  const toAfter = calculatePlanUsage([...input.toAssets, input.asset], input.limits);

  return {
    from: { before: fromBefore, after: fromAfter },
    to: { before: toBefore, after: toAfter },
  };
}
