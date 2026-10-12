import { useCallback, useEffect, useState } from 'react';
import {
  useGetSelectedOrganizationId,
  useSwitchToOrganization,
} from '@modules/organization/infrastructure/importer-api';
import useSelectableOrganization from './use-selectable-organization';
import useOrganizationKeyPurge from './use-organization-key-purge';

export type SwitchOrganizationPhase = 'idle' | 'switching' | 'checking' | 'ready' | 'blocked';

export interface SwitchOrganizationFlow {
  phase: SwitchOrganizationPhase;
  selectedOrganizationId: string | null;
  blockedReason: string | null;
  pendingOrganizationId: string | null;
  canUse: boolean;
  accessLoading: boolean;
  accessOrganizationId?: string;
  selectOrganization: (organizationId: string) => Promise<void>;
  reset: () => void;
}

/**
 * Importer-scoped orchestration for the Switch Organization screen.
 *
 * Picking a row calls the local `useSwitchToOrganization` (which owns the
 * cache-purge + preference write), then the selected-org status hooks
 * re-resolve for the new context and `useSelectableOrganization` reduces them
 * to `ready` / `blocked`. No blocking logic is duplicated here.
 *
 * Before that, it purges any Organization Key held for the organisation being
 * left (`useOrganizationKeyPurge`) — org switching with an active
 * workspace must never leave organisation A's key material reachable once
 * organisation B is selected.
 */
export default function useSwitchOrganizationFlow(): SwitchOrganizationFlow {
  const { switchToOrganization } = useSwitchToOrganization();
  const selectedOrganizationId = useGetSelectedOrganizationId();
  const { canUse, blockedReason, loading, organizationId } = useSelectableOrganization();
  const { purgeOrganization } = useOrganizationKeyPurge();

  const [pendingOrganizationId, setPendingOrganizationId] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);

  const selectOrganization = useCallback(
    async (nextOrganizationId: string) => {
      setPendingOrganizationId(nextOrganizationId);
      setIsSwitching(true);
      try {
        if (selectedOrganizationId && selectedOrganizationId !== nextOrganizationId) {
          await purgeOrganization(selectedOrganizationId);
        }
        await switchToOrganization(nextOrganizationId);
      } finally {
        setIsSwitching(false);
      }
    },
    [switchToOrganization, selectedOrganizationId, purgeOrganization],
  );

  useEffect(() => {
    if (!pendingOrganizationId || isSwitching || !selectedOrganizationId) return;
    const selectionChangedExternally = selectedOrganizationId !== pendingOrganizationId;
    const selectionResolved = !loading && organizationId === pendingOrganizationId;
    if (selectionChangedExternally || selectionResolved) setPendingOrganizationId(null);
  }, [isSwitching, loading, organizationId, pendingOrganizationId, selectedOrganizationId]);

  const reset = useCallback(() => setPendingOrganizationId(null), []);

  const phase = derivePhase({
    pendingOrganizationId,
    selectedOrganizationId,
    isSwitching,
    loading,
    statusOrganizationId: organizationId,
    canUse,
  });

  useEffect(() => {
    console.debug('[organization-flow]', {
      phase,
      selectedOrganizationId,
      pendingOrganizationId,
      statusOrganizationId: organizationId,
      loading,
      canUse,
    });
  }, [canUse, loading, organizationId, pendingOrganizationId, phase, selectedOrganizationId]);

  return {
    phase,
    selectedOrganizationId,
    blockedReason:
      phase === 'blocked'
        ? (blockedReason ??
          'We could not verify this organisation’s access. Check the browser console for the failed request and try again.')
        : null,
    pendingOrganizationId,
    canUse,
    accessLoading: loading,
    accessOrganizationId: organizationId,
    selectOrganization,
    reset,
  };
}

interface DerivePhaseInput {
  pendingOrganizationId: string | null;
  selectedOrganizationId: string | null;
  isSwitching: boolean;
  loading: boolean;
  statusOrganizationId?: string;
  canUse: boolean;
}

function derivePhase({
  pendingOrganizationId,
  selectedOrganizationId,
  isSwitching,
  loading,
  statusOrganizationId,
  canUse,
}: DerivePhaseInput): SwitchOrganizationPhase {
  if (isSwitching) return 'switching';
  const targetOrganizationId = pendingOrganizationId ?? selectedOrganizationId;
  if (!targetOrganizationId) return 'idle';
  if (loading) return 'checking';
  if (!statusOrganizationId) return 'blocked';
  if (statusOrganizationId !== targetOrganizationId) return 'checking';
  if (canUse) return 'ready';
  return 'blocked';
}
