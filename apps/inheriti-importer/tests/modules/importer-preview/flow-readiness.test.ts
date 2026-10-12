import { describe, expect, it } from 'vitest';
import { getImporterFlowReadiness } from '@modules/importer-preview/ImporterFlow/application/flow-readiness';
import type { ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';
import type { PlanDraft } from '@modules/importer-preview/PlanGroupingSurface';
import type { ImportFile } from '@modules/importer-preview/SourceImportStatus';

const file: ImportFile = { name: 'source.env', format: 'dotenv', status: 'imported' };
const asset: ReviewAsset = {
  id: 'asset-1',
  name: 'Asset',
  type: 'API-KEY',
  status: 'accepted',
  confidence: '100%',
  rationale: '',
  mapped: [],
  unmapped: [],
  source: 'source.env',
  alternatives: [],
};
const plan: PlanDraft = {
  id: 'plan-1',
  name: 'Plan',
  assets: 1,
  capacity: '1 / 10 Assets',
  valid: true,
};

describe('importer flow readiness', () => {
  it('rejects empty and incomplete input', () => {
    expect(getImporterFlowReadiness({ files: [], assets: [], unassigned: [], plans: [] })).toEqual({
      sources: false,
      assets: false,
      plans: false,
      staging: false,
    });
    expect(
      getImporterFlowReadiness({
        files: [file],
        assets: [asset],
        unassigned: [asset],
        plans: [plan],
      }).staging,
    ).toBe(false);
  });

  it('requires every sibling Plan to be valid and within capacity', () => {
    const invalid = { ...plan, id: 'plan-2', valid: false };
    const overCapacity = { ...plan, id: 'plan-3', assets: 11, capacity: '11 / 10 Assets' };

    expect(
      getImporterFlowReadiness({ files: [file], assets: [asset], unassigned: [], plans: [plan] }),
    ).toEqual({ sources: true, assets: true, plans: true, staging: true });
    expect(
      getImporterFlowReadiness({
        files: [file],
        assets: [asset],
        unassigned: [],
        plans: [plan, invalid],
      }).plans,
    ).toBe(false);
    expect(
      getImporterFlowReadiness({
        files: [file],
        assets: [asset],
        unassigned: [],
        plans: [plan, overCapacity],
      }).plans,
    ).toBe(false);
  });
});
