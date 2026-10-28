import { Box, Pressable, Text } from '@modules/_shared/ui/components';
import type {
  AccountDestinations as Destinations,
  SavedAccount,
} from '@modules/auth/infrastructure/electron-auth-provider';
import { organizationDisplayName } from '@modules/organization/application/organization-display-name';

export function AccountDestinations({
  accounts,
  destinations,
  onSwitch,
  onRemove,
  onSelectCurrentOrganization,
}: {
  accounts: SavedAccount[];
  destinations: Destinations[];
  onSwitch: (account: SavedAccount, organization?: { id: string; name: string }) => void;
  onRemove: (account: SavedAccount) => void;
  onSelectCurrentOrganization: (organizationId: string) => void;
}) {
  return (
    <>
      {accounts.map((account) => {
        const group = destinations.find((item) => item.accountKey === account.key);
        return (
          <Box key={account.key} gap="xxs" padding="s">
            <Text variant="bodySmall" color="gray120">
              {account.subject}
              {account.active ? ' · Current' : ''}
            </Text>
            {group?.status === 'sign_in_required' ? (
              <Text variant="bodySmall" color="gray">
                Sign in again to see organisations.
              </Text>
            ) : null}
            {group?.status === 'ready' && group.organizations.length === 0 ? (
              <Text variant="bodySmall" color="gray">
                No available organisations.
              </Text>
            ) : null}
            {group?.status === 'ready' &&
              group.organizations.map((organization) => {
                const name = organizationDisplayName(organization, group.organizations);
                return account.active ? (
                  <Pressable
                    key={organization.id}
                    accessibilityRole="menuitem"
                    accessibilityLabel={`Open ${name} in current account`}
                    onPress={() => onSelectCurrentOrganization(organization.id)}
                  >
                    <Box padding="s">
                      <Text variant="bodySmall" color="gray120">
                        {name}
                      </Text>
                    </Box>
                  </Pressable>
                ) : (
                  <Pressable
                    key={organization.id}
                    accessibilityRole="menuitem"
                    accessibilityLabel={`Switch to ${account.subject} and open ${name}`}
                    onPress={() => onSwitch(account, { id: organization.id, name })}
                  >
                    <Box padding="s">
                      <Text variant="bodySmall" color="gray120">
                        {name}
                      </Text>
                    </Box>
                  </Pressable>
                );
              })}
            {!account.active ? (
              <>
                <Pressable
                  accessibilityRole="menuitem"
                  accessibilityLabel={`Switch to account ${account.subject}`}
                  onPress={() => onSwitch(account)}
                >
                  <Box padding="s">
                    <Text variant="bodySmall" color="gray120">
                      Open account
                    </Text>
                  </Box>
                </Pressable>
                <Pressable
                  accessibilityRole="menuitem"
                  accessibilityLabel={`Remove saved account ${account.subject}`}
                  onPress={() => onRemove(account)}
                >
                  <Box padding="s">
                    <Text variant="bodySmall" color="danger">
                      Remove saved login
                    </Text>
                  </Box>
                </Pressable>
              </>
            ) : null}
          </Box>
        );
      })}
    </>
  );
}
