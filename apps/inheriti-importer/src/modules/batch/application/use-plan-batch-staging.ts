import { useMemo } from 'react';
import { assertPlanBatchPreflight } from './batch-preflight';
import type { MaterialisedAsset } from '@modules/plans/domain/asset-materializer';
import type { ImportSession } from '@modules/import/domain/import-model';
import type { PlanBatchInput } from '../domain/plan-batch-input';
import { ImporterToolRepo, type StagedPlanDraft } from '../infrastructure/importer-tool-repo';
import type { OrganizationKeyRelease } from './use-organization-key-release';

export function usePlanBatchStaging({
  session,
  organizationId,
  currentMemberId,
  keyRelease,
  importerToolRepo,
}: {
  session: ImportSession;
  organizationId: string | undefined;
  currentMemberId: string | undefined;
  keyRelease: OrganizationKeyRelease;
  importerToolRepo: ImporterToolRepo;
}) {
  return useMemo(
    () => ({
      validate: (item: { input: PlanBatchInput }) => {
        assertPlanBatchPreflight(item.input, session, { organizationId });
      },
      create: async () => {},
      configure: async (item: { planId: string; input: PlanBatchInput }) => {
        if (!organizationId) throw new Error('No organization is selected.');
        if (!currentMemberId) {
          throw new Error('The current organization member could not be determined.');
        }
        const masterKey = await keyRelease.acquire(item.planId);
        if (await importerToolRepo.isStaged(organizationId, item.planId)) return;
        await importerToolRepo.stage({
          id: item.planId,
          organizationId,
          memberId: currentMemberId,
          organizationKeyHex: masterKey,
          planDraft: item.input.payload as StagedPlanDraft,
          assets: item.input.assets as MaterialisedAsset[],
        });
      },
    }),
    [session, organizationId, currentMemberId, keyRelease, importerToolRepo],
  );
}
