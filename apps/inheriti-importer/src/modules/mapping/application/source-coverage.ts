import type { ImportDiagnostic } from '@modules/import/domain/import-diagnostic';
import type { ImportSession } from '@modules/import/domain/import-model';
import {
  getPlanAssetFormFields,
  validateAssetEditorValues,
} from '@modules/plans/domain/asset-metadata';
import { materialiseAsset } from '@modules/plans/domain/asset-materializer';
import type { AssetDraft } from '@modules/plans/domain/workspace-model';
import { bindingSourceIds } from './suggestion-engine';

export interface SourceCoverageField {
  id: string;
  name: string;
  sourceId: string;
  nodeId: string;
  status: 'mapped' | 'protected' | 'excluded' | 'pending' | 'invalid';
  destinations: Array<{ assetId: string; fieldId: string; valid?: boolean }>;
}

export interface SourceCoverage {
  fields: SourceCoverageField[];
  diagnostics: Array<ImportDiagnostic & { sourceId: string }>;
  ready: boolean;
}

export function sourceCoverage(
  session: ImportSession,
  assets: readonly AssetDraft[],
  excludedIds: ReadonlySet<string>,
): SourceCoverage {
  type Destination = SourceCoverageField['destinations'][number] & {
    valid: boolean;
    protectedText: boolean;
  };
  const byField = new Map<string, Destination[]>();
  for (const asset of assets) {
    const schemaFields = new Set(getPlanAssetFormFields(asset.type).map((field) => field.source));
    const materialised = materialiseAsset(asset, session);
    const valid =
      !materialised.errors.length &&
      !Object.keys(validateAssetEditorValues(asset.type, materialised.asset)).length;
    for (const [fieldId, binding] of Object.entries(asset.fieldBindings)) {
      for (const id of bindingSourceIds(binding)) {
        const destinations = byField.get(id) ?? [];
        destinations.push({
          assetId: asset.id,
          fieldId,
          protectedText: asset.type === 'PLAIN-TEXT' && fieldId === 'secret.text',
          valid:
            valid &&
            schemaFields.has(fieldId) &&
            (fieldId.startsWith('secret.') || fieldId === 'meta.notes'),
        });
        byField.set(id, destinations);
      }
    }
  }
  const fields = Object.values(session.fieldsById)
    .filter((field) => !field.value.isEmpty)
    .map((field): SourceCoverageField => {
      const references = byField.get(field.id) ?? [];
      const valid = references.filter((destination) => destination.valid);
      return {
        id: field.id,
        name: field.name,
        sourceId: field.sourceId,
        nodeId: field.parentNodeId,
        status: valid.some((destination) => destination.protectedText)
          ? 'protected'
          : valid.length
            ? 'mapped'
            : excludedIds.has(field.id)
              ? 'excluded'
              : references.length
                ? 'invalid'
                : 'pending',
        destinations: references.map(({ assetId, fieldId, valid }) => ({
          assetId,
          fieldId,
          valid,
        })),
      };
    });
  return {
    fields,
    diagnostics: session.sources.flatMap((source) =>
      (source.diagnostics ?? []).map((diagnostic) => ({ ...diagnostic, sourceId: source.id })),
    ),
    ready: fields.every((field) => field.status !== 'invalid' && field.status !== 'pending'),
  };
}
