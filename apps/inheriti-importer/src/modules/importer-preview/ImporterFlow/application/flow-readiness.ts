import type { ReviewAsset } from '../../AssetReviewQueue';
import { isPlanOverCapacity } from '../../PlanGroupingSurface/capacity';
import type { GroupingAsset, PlanDraft } from '../../PlanGroupingSurface';
import type { ImportFile } from '../../SourceImportStatus';

export type ImporterFlowReadiness = {
  sources: boolean;
  assets: boolean;
  plans: boolean;
  staging: boolean;
};

export function getImporterFlowReadiness(input: {
  files: ImportFile[];
  assets: ReviewAsset[];
  unassigned: GroupingAsset[];
  plans: PlanDraft[];
  preservationReady?: boolean;
  executionCoverageReady?: boolean;
}): ImporterFlowReadiness {
  const sources =
    input.files.length > 0 &&
    input.files.every(
      (file) =>
        file.status === 'imported' ||
        (file.status === 'warning' && (!file.diagnostics?.length || file.warningsAcknowledged)),
    );
  const assets =
    input.preservationReady !== false &&
    input.assets.length > 0 &&
    input.assets.every((asset) => asset.status === 'accepted' || asset.status === 'excluded');
  const plans =
    input.plans.length > 0 &&
    input.unassigned.length === 0 &&
    input.plans.every((plan) => plan.valid && !isPlanOverCapacity(plan));

  return {
    sources,
    assets,
    plans,
    staging: sources && assets && plans && input.executionCoverageReady !== false,
  };
}
