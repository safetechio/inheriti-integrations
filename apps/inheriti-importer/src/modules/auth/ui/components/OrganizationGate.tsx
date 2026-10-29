import { Box, Icon, NoItemsPlaceholder, Text } from '@modules/_shared/ui/components';
import Button from '@modules/_shared/ui/components/Base/Button';
import { useTheme } from '@modules/_shared/ui/theme/AppTheme';
import useOrganizationMemberships from '@modules/organization/application/use-organization-memberships';
import useSwitchOrganizationFlow from '@modules/organization/application/use-switch-organization-flow';
import OrganizationOptionRow from '@modules/organization/ui/components/OrganizationOptionRow';
import { organizationDisplayName } from '@modules/organization/application/organization-display-name';
import { useAuthState } from '@shared/infrastructure/importer-api';
import { AppHeader } from '@modules/import/ui/components/AppHeader';
import { BrandLogo } from '@modules/import/ui/components/BrandLogo';
import { useEffect, type ReactNode } from 'react';

export default function OrganizationGate({
  children,
  onSignOut,
}: {
  children: ReactNode;
  onSignOut: () => void;
}) {
  const uiTheme = useTheme();
  const authNotice = useAuthState((state) => (state as { notice?: string | null }).notice ?? null);
  const { memberships, loading } = useOrganizationMemberships();
  const {
    phase,
    blockedReason,
    selectedOrganizationId,
    pendingOrganizationId,
    canUse,
    accessLoading,
    accessOrganizationId,
    selectOrganization,
    reset,
  } = useSwitchOrganizationFlow();
  const accessBlockedReason = phase === 'ready' ? blockedReason : null;
  const selectedId = pendingOrganizationId ?? selectedOrganizationId;
  // `useSelectableOrganization` always reflects whichever org is *currently*
  // active in the Importer context — while switching, that can briefly still
  // be the previous org. Only trust `canUse`/`accessBlockedReason` once its
  // own `organizationId` has actually caught up to the one we're showing.
  const accessMatchesSelection = !!selectedId && accessOrganizationId === selectedId;

  useEffect(() => {
    console.debug('[organization-gate]', {
      phase,
      membershipsLoading: loading,
      selectedId,
      pendingOrganizationId,
      selectedOrganizationId,
      accessOrganizationId,
      accessLoading,
      accessMatchesSelection,
      canUse,
      blockedReason,
      accessBlockedReason,
    });
  }, [
    accessBlockedReason,
    accessLoading,
    accessMatchesSelection,
    accessOrganizationId,
    blockedReason,
    canUse,
    loading,
    pendingOrganizationId,
    phase,
    selectedId,
    selectedOrganizationId,
  ]);

  useEffect(() => {
    if (!selectedOrganizationId || pendingOrganizationId || loading || phase !== 'idle') return;
    if (accessMatchesSelection && !accessLoading && canUse) return;
    void selectOrganization(selectedOrganizationId);
  }, [
    accessLoading,
    accessMatchesSelection,
    canUse,
    loading,
    pendingOrganizationId,
    phase,
    selectedOrganizationId,
    selectOrganization,
  ]);

  if (selectedId && !accessLoading && accessMatchesSelection && canUse) return <>{children}</>;

  return (
    <Box className="app">
      <header className="titlebar">
        <Box className="brand"><BrandLogo business className="brand-logo" /></Box>
        <AppHeader dirtyCount={0} accountActionsDisabled={phase === 'switching' || phase === 'checking'} showOrganizationMenu={false} />
      </header>
      <Box justifyContent="center" alignItems="center" padding="l">
      <Box maxWidth={520} width="100%" backgroundColor="white" borderRadius="s">
        <Box
          flexDirection="row"
          gap="m"
          alignItems="center"
          padding="l"
          style={{ borderBottomWidth: 1, borderBottomColor: uiTheme.colors.gray10 }}
        >
          <Box
            width={48}
            height={48}
            borderRadius="pill"
            borderWidth={1}
            borderColor="primary10"
            backgroundColor="primary5"
            alignItems="center"
            justifyContent="center"
          >
            <Icon name="building" size={20} color="primary" label="Organisation" />
          </Box>
          <Box flex={1} gap="xxs">
            <Text variant="heading2" color="primary200">
              Choose an organisation
            </Text>
            <Text variant="bodyRegular" color="gray">
              Select the organisation that will own this import.
            </Text>
          </Box>
        </Box>
        <Box padding="l" gap="m">
          {authNotice ? (
            <Text variant="bodySmall" color="danger">
              {authNotice}
            </Text>
          ) : null}
          {loading ? (
            <Text variant="bodySmall" color="gray">
              Loading organisations…
            </Text>
          ) : null}
          {phase === 'ready' && (accessLoading || !accessMatchesSelection) ? (
            <Text variant="bodySmall" color="gray">
              Checking organization access…
            </Text>
          ) : null}
          {!loading && memberships.length === 0 ? (
            <NoItemsPlaceholder
              iconName="building"
              description="No organisations are available for this account."
            />
          ) : null}
          {memberships.map((organization) => {
            // Once we know *this* organisation is blocked (trial/subscription
            // lapsed), retrying the same selection can't succeed — disable it
            // and show why on *this* row, not a generic top banner, so it's
            // clear which organisation the problem belongs to (you can be a
            // member of more than one).
            const rowBlockedMessage =
              phase === 'switching'
                ? 'Switching organisation…'
                : phase === 'checking'
                  ? 'Checking organization access…'
                  : phase === 'blocked' && selectedId === organization.id
                    ? blockedReason
                    : phase === 'ready' && accessOrganizationId === organization.id
                      ? accessBlockedReason
                      : null;
            const isBlocked = Boolean(rowBlockedMessage);
            return (
              <OrganizationOptionRow
                key={organization.id}
                name={organizationDisplayName(organization, memberships)}
                isOwned={organization.isOwned}
                loading={
                  pendingOrganizationId === organization.id &&
                  (phase === 'switching' || phase === 'checking')
                }
                disabled={phase === 'switching' || phase === 'checking' || isBlocked}
                blockedMessage={rowBlockedMessage}
                messageTone={phase === 'switching' || phase === 'checking' ? 'neutral' : 'danger'}
                onSelect={() => {
                  void selectOrganization(organization.id);
                }}
              />
            );
          })}
          {phase === 'blocked' ? (
            <Button title="Choose another organisation" variant="plain" onPress={reset} />
          ) : null}
        </Box>
        <Box
          padding="l"
          alignItems="center"
          style={{ borderTopWidth: 1, borderTopColor: uiTheme.colors.gray10 }}
        >
          <Button title="Sign out" variant="plain" size="sm" onPress={onSignOut} />
        </Box>
      </Box>
      </Box>
    </Box>
  );
}
