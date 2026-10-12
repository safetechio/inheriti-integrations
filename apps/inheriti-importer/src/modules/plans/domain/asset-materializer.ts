import type { ImportSession } from '@modules/import/domain/import-model';
import type { AssetDraft, PlanDraft } from '@modules/plans/domain/workspace-model';

/**
 * Turns `AssetDraft`s (which hold *bindings*) into the plain
 * `{ id?, type, meta, secret }` shape Core's `DataAssetInputValidator` /
 * `validation and staging` expect. The materialised objects are held only
 * as long as validation / staging needs them, then released.
 */

export interface MaterialisedAsset {
  id?: string;
  type: string;
  meta: { name: string; notes?: string; isMedia?: boolean; mimeType?: string; fileName?: string };
  secret: Record<string, unknown>;
}

export interface MaterialisationFieldError {
  assetId: string;
  assetFieldSource: string;
  code: 'MISSING_SOURCE_FIELD' | 'EMPTY_VALUE' | 'INVALID_VALUE';
  message: string;
}

export interface MaterialisationResult {
  assets: MaterialisedAsset[];
  errors: MaterialisationFieldError[];
}

/** Splits `'secret.password'` -> `['secret', 'password']`; anything else -> as-is. */
function pathParts(source: string): string[] {
  return source.split('.');
}

function setPath(target: Record<string, unknown>, parts: string[], value: unknown): void {
  let node = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i]!;
    if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]!] = value;
}

function normaliseAssetFieldValue(assetFieldSource: string, value: string): unknown {
  if (assetFieldSource === 'secret.words') {
    return value
      .split(/\s+/)
      .map((word) => word.trim())
      .filter(Boolean);
  }
  return value;
}

export function materialiseAsset(
  asset: AssetDraft,
  session: ImportSession,
): { asset: MaterialisedAsset; errors: MaterialisationFieldError[] } {
  const errors: MaterialisationFieldError[] = [];
  const bag: Record<string, unknown> = { secret: {}, meta: { name: asset.name } };

  for (const [assetFieldSource, binding] of Object.entries(asset.fieldBindings)) {
    let value: string | undefined;

    if (binding.kind === 'literal') {
      value = binding.value.reveal();
    } else if (binding.kind === 'source') {
      const field = session.fieldsById[binding.sourceFieldId];
      if (!field) {
        errors.push({
          assetId: asset.id,
          assetFieldSource,
          code: 'MISSING_SOURCE_FIELD',
          message: 'The bound source field no longer exists in the import.',
        });
        continue;
      }
      value = field.value.reveal();
    } else {
      const lines: string[] = [];
      for (const source of binding.sources) {
        const field = session.fieldsById[source.sourceFieldId];
        if (!field) {
          errors.push({
            assetId: asset.id,
            assetFieldSource,
            code: 'MISSING_SOURCE_FIELD',
            message: 'A bound source field no longer exists in the import.',
          });
          continue;
        }
        if (!field.value.isEmpty) lines.push(`${source.name}: ${field.value.reveal()}`);
      }
      value = lines.join('\n');
    }

    if (!value) {
      errors.push({
        assetId: asset.id,
        assetFieldSource,
        code: 'EMPTY_VALUE',
        message: 'The bound value is empty.',
      });
      continue;
    }

    setPath(bag, pathParts(assetFieldSource), normaliseAssetFieldValue(assetFieldSource, value));
  }

  const materialised: MaterialisedAsset = {
    id: asset.id,
    type: asset.type,
    meta: (bag.meta as MaterialisedAsset['meta']) ?? { name: asset.name },
    secret: (bag.secret as Record<string, unknown>) ?? {},
  };

  return { asset: materialised, errors };
}

export function materialisePlanAssets(
  plan: PlanDraft,
  session: ImportSession,
): MaterialisationResult {
  const assets: MaterialisedAsset[] = [];
  const errors: MaterialisationFieldError[] = [];

  for (const draft of plan.assets) {
    const { asset, errors: assetErrors } = materialiseAsset(draft, session);
    assets.push(asset);
    errors.push(...assetErrors);
  }

  return { assets, errors };
}
