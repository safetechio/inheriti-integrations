import { useCallback, useMemo, useRef } from 'react';
import { assertImportPreservationReady, assertPlanBatchPreflight } from './batch-preflight';
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
  preservationReady = true,
  preservationRevision,
}: {
  session: ImportSession;
  organizationId: string | undefined;
  currentMemberId: string | undefined;
  keyRelease: OrganizationKeyRelease;
  importerToolRepo: ImporterToolRepo;
  preservationReady?: boolean;
  preservationRevision?: symbol;
}) {
  const latestPreservation = useRef({ preservationReady, preservationRevision });
  const submittedPlans = useRef(new Map<string, Uint8Array>());
  const receiptKey = useRef<Promise<CryptoKey> | null>(null);
  latestPreservation.current = { preservationReady, preservationRevision };
  const assertCurrentRevision = useCallback((input: PlanBatchInput) => {
    const latest = latestPreservation.current;
    assertImportPreservationReady(latest.preservationReady);
    if (input.preservationRevision !== latest.preservationRevision)
      throw new Error(
        'The import changed since this batch started. Start staging again with the reviewed plans.',
      );
  }, []);
  return useMemo(
    () => ({
      validate: (item: { input: PlanBatchInput }) => {
        assertCurrentRevision(item.input);
        assertPlanBatchPreflight(item.input, session, { organizationId });
      },
      create: async () => {},
      configure: async (item: { planId: string; input: PlanBatchInput }, signal: AbortSignal) => {
        assertCurrentRevision(item.input);
        if (!organizationId) throw new Error('No organization is selected.');
        if (!currentMemberId) {
          throw new Error('The current organization member could not be determined.');
        }
        const masterKey = await keyRelease.acquire(item.planId);
        if (signal.aborted) return;
        assertCurrentRevision(item.input);
        const staged = await importerToolRepo.isStaged(organizationId, item.planId, signal);
        if (signal.aborted) return;
        assertCurrentRevision(item.input);
        const stagedKey = `${organizationId}:${item.planId}`;
        const submitted = submittedPlans.current.get(stagedKey);
        if (staged && !submitted) return;
        let fingerprint: Uint8Array | undefined;
        if (item.input.preservationRevision) {
          // Key the receipt so it cannot be used to guess an imported value.
          receiptKey.current ??= crypto.subtle.generateKey(
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign'],
          );
          const key = await receiptKey.current;
          if (signal.aborted) return;
          assertCurrentRevision(item.input);
          const { assets: _assets, ...planDraft } = item.input.payload;
          const data = new TextEncoder().encode(
            JSON.stringify([currentMemberId, planDraft, item.input.assets]),
          );
          try {
            fingerprint = new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
          } finally {
            data.fill(0);
          }
          if (signal.aborted) return;
          assertCurrentRevision(item.input);
        }
        if (staged) {
          if (!fingerprint || !submitted?.every((byte, index) => byte === fingerprint[index]))
            throw new Error(
              'An earlier revision of this Plan is already staged. Create a new Plan draft to stage the updated import.',
            );
          return;
        }
        await importerToolRepo.stage(
          {
            id: item.planId,
            organizationId,
            memberId: currentMemberId,
            organizationKeyHex: masterKey,
            planDraft: item.input.payload as StagedPlanDraft,
            assets: item.input.assets as MaterialisedAsset[],
          },
          signal,
          () => {
            assertCurrentRevision(item.input);
            if (fingerprint) submittedPlans.current.set(stagedKey, fingerprint);
          },
        );
        if (!signal.aborted) assertCurrentRevision(item.input);
      },
    }),
    [session, organizationId, currentMemberId, keyRelease, importerToolRepo, assertCurrentRevision],
  );
}
