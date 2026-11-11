import { useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthState } from '@shared/infrastructure/importer-api';
import useOrganizationMemberships from '@modules/organization/application/use-organization-memberships';
import useSwitchOrganizationFlow from '@modules/organization/application/use-switch-organization-flow';
import { AppShell } from '@modules/import/ui/components/AppShell';
import { ImportPanel } from '@modules/import/ui/components/ImportPanel';
import { isAccessDenial } from '@modules/_shared/domain/api-status-error';

export default function OrganizationGate({
  children,
}: {
  children: ReactNode;
  onSignOut: () => void;
}) {
  const queryClient = useQueryClient();
  const authNotice = useAuthState((state) => (state as { notice?: string | null }).notice ?? null);
  const { memberships, loading, error } = useOrganizationMemberships();
  const {
    phase,
    blockedReason,
    selectedOrganizationId,
    pendingOrganizationId,
    canUse,
    accessLoading,
    accessOrganizationId,
    selectOrganization,
  } = useSwitchOrganizationFlow();
  const selectedId = pendingOrganizationId ?? selectedOrganizationId;
  const authorized =
    !!selectedId &&
    !isAccessDenial(error) &&
    (!error || memberships.some((item) => item.id === selectedId)) &&
    !loading &&
    !accessLoading &&
    phase === 'ready' &&
    accessOrganizationId === selectedId &&
    canUse;

  useEffect(() => {
    if (error || loading || phase !== 'idle' || selectedOrganizationId || pendingOrganizationId)
      return;
    if (memberships.length === 1) void selectOrganization(memberships[0].id);
  }, [
    error,
    loading,
    memberships,
    phase,
    selectedOrganizationId,
    pendingOrganizationId,
    selectOrganization,
  ]);

  useEffect(() => {
    if (error || loading || phase !== 'idle' || !selectedOrganizationId || pendingOrganizationId)
      return;
    if (accessOrganizationId === selectedOrganizationId && !accessLoading && canUse) return;
    void selectOrganization(selectedOrganizationId);
  }, [
    error,
    loading,
    phase,
    selectedOrganizationId,
    pendingOrganizationId,
    accessOrganizationId,
    accessLoading,
    canUse,
    selectOrganization,
  ]);

  if (authorized) return <>{children}</>;

  const notice =
    authNotice ??
    (error
      ? 'Could not load organisations. Retry or choose another account.'
      : loading
        ? 'Loading organisations…'
        : phase === 'switching'
          ? 'Switching organisation…'
          : phase === 'checking' || accessLoading
            ? 'Checking organisation access…'
            : phase === 'blocked'
              ? (blockedReason ?? 'Could not verify organisation access.')
              : memberships.length === 0
                ? 'No organisations are available for this account.'
                : 'Choose an organisation from the menu above to start an import.');

  return (
    <AppShell dirtyCount={0}>
      <ImportPanel
        busy={false}
        disabled
        notice={notice}
        onRetry={
          error || phase === 'blocked'
            ? () => {
                void queryClient.invalidateQueries();
              }
            : undefined
        }
        error={null}
        onImport={() => {}}
      />
    </AppShell>
  );
}
