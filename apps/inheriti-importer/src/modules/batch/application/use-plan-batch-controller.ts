import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ElectronHttpTransport } from '@modules/_shared/infrastructure/transport/electron-http-transport';
import type { ImportSession } from '@modules/import/domain/import-model';
import type { PlanDraft } from '@modules/plans/domain/workspace-model';
import {
  createNoopTelemetrySink,
  type ImportTelemetrySink,
} from '@shared/infrastructure/telemetry';
import type { PlanBatchInput } from '../domain/plan-batch-input';
import { ImporterToolRepo } from '../infrastructure/importer-tool-repo';
import { useOrganizationKeyRelease } from './use-organization-key-release';
import { usePlanBatchContext } from './use-plan-batch-context';
import { usePlanBatchEntries } from './use-plan-batch-entries';
import { usePlanBatchExecution } from './use-plan-batch-execution';
import { usePlanBatchStaging } from './use-plan-batch-staging';
import { usePlanBatch } from './use-plan-batch';

export interface PlanBatchControllerItem {
  planId: string;
  status: string;
  error?: unknown;
}
type MasterKeySessionStep = 'preparing' | 'ready' | 'available' | 'error' | 'not-claimed';
export interface PlanBatchControllerResult {
  complete: PlanBatchControllerItem[];
  createdUnconfigured: PlanBatchControllerItem[];
  failed: PlanBatchControllerItem[];
  cancelled: PlanBatchControllerItem[];
}
export interface PlanBatchControllerState {
  organizationId: string | undefined;
  organizationKey: {
    configured: boolean | undefined;
    configuredLoading: boolean;
    activePlanId: string | null;
    step: MasterKeySessionStep | 'idle';
    error: string | null;
    localKeyAvailable: boolean | undefined;
    canSimulateLocally: boolean;
    simulateLocalRelease: (pin: string) => Promise<void>;
  };
  storage: { loading: boolean; activeDataStorageLayerCount: number | undefined };
  ready: boolean;
  running: boolean;
  items: readonly PlanBatchControllerItem[];
  result: PlanBatchControllerResult;
  requestOrganizationKey: () => void;
  cancelOrganizationKeyRequest: () => void;
  execute: () => void;
  retryCreate: (planId: string) => void;
  retryConfigure: (planId: string) => void;
  cancel: () => void;
}

export function usePlanBatchController({
  plans,
  session,
  onSuccess,
  telemetry = createNoopTelemetrySink(),
}: {
  plans: PlanDraft[];
  session: ImportSession;
  onSuccess: () => void;
  telemetry?: ImportTelemetrySink;
}): PlanBatchControllerState {
  const context = usePlanBatchContext();
  const keyRelease = useOrganizationKeyRelease({
    organizationId: context.organizationId,
    identity: context.identity,
    vault: context.organizationKeyVault,
  });
  const transport = useMemo(() => new ElectronHttpTransport(), []);
  const importerToolRepo = useMemo(() => new ImporterToolRepo(transport), [transport]);
  const entries = usePlanBatchEntries({
    plans,
    session,
    organizationId: context.organizationId,
    currentMemberId: context.currentMember?.id,
    approvalMode: context.policy.approvalMode,
    totalShares: context.storageSummary?.activeDataStorageLayerCount ?? 0,
  });
  const callbacks = usePlanBatchStaging({
    session,
    organizationId: context.organizationId,
    currentMemberId: context.currentMember?.id,
    keyRelease,
    importerToolRepo,
  });
  const batch = usePlanBatch<PlanBatchInput>(callbacks);
  const actions = usePlanBatchExecution({ entries, batch, telemetry, keyRelease });
  const completionArmed = useRef(false);
  const successReported = useRef(false);
  const run = useCallback((action: () => void) => {
    completionArmed.current = true;
    successReported.current = false;
    action();
  }, []);
  const cancel = useCallback(() => {
    completionArmed.current = false;
    actions.cancel();
  }, [actions.cancel]);
  useEffect(() => {
    if (
      !completionArmed.current ||
      successReported.current ||
      batch.running ||
      batch.items.length === 0 ||
      batch.items.length !== entries.length ||
      batch.items.some((item) => item.status !== 'COMPLETE')
    )
      return;
    successReported.current = true;
    onSuccess();
  }, [batch.items, batch.running, entries.length, onSuccess]);
  return {
    organizationId: context.organizationId,
    organizationKey: {
      configured: context.organizationKeyReady,
      configuredLoading: context.organizationKeyLoading,
      activePlanId: keyRelease.state.activePlanId,
      step: keyRelease.state.step,
      error: keyRelease.state.error,
      localKeyAvailable: keyRelease.state.localKeyAvailable,
      canSimulateLocally: keyRelease.state.canSimulateLocally,
      simulateLocalRelease: keyRelease.simulateLocalRelease,
    },
    storage: {
      loading: context.storageLoading,
      activeDataStorageLayerCount: context.storageSummary?.activeDataStorageLayerCount,
    },
    ready: plans.length > 0,
    running: batch.running,
    items: batch.items,
    result: batch.result,
    requestOrganizationKey: actions.requestOrganizationKey,
    cancelOrganizationKeyRequest: cancel,
    execute: () => run(actions.execute),
    retryCreate: (planId) => run(() => actions.retryCreate(planId)),
    retryConfigure: (planId) => run(() => actions.retryConfigure(planId)),
    cancel,
  };
}
