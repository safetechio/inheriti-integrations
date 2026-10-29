import { Box, Pressable, Text } from '@modules/_shared/ui/components';
import type { AccountDestinations as Destinations, SavedAccount } from '@modules/auth/infrastructure/electron-auth-provider';

export function AccountDestinations({
  accounts,
  destinations,
  onSwitch,
  onRemove,
}: {
  accounts: SavedAccount[];
  destinations: Destinations[];
  onSwitch: (account: SavedAccount) => void;
  onRemove: (account: SavedAccount) => void;
}) {
  return (
    <>
      {accounts.filter((account) => !account.active).map((account) => {
        const destination = destinations.find((item) => item.accountKey === account.key);
        const name = destination?.displayName && destination.displayName !== destination.email
          ? destination.displayName : 'Saved account';
        return (
          <Box key={account.key} className="account-menu-destination" flexDirection="row" alignItems="center">
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel={`Switch to account ${name}`}
              onPress={() => onSwitch(account)}
              style={{ flex: 1, minWidth: 0 }}
            >
              <Box className="account-menu-option" flexDirection="row" alignItems="center" gap="m">
              <Box className="account-menu-avatar" width={34} height={34} borderRadius="pill" alignItems="center" justifyContent="center">
                <Text color="white" style={{ fontWeight: 400, fontSize: 13 }}>
                  {name.trim().split(/\s+/u).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'}
                </Text>
              </Box>
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Text variant="bodySmall" color="primary200" numberOfLines={1} style={{ fontWeight: 600 }}>
                  {name}
                </Text>
                {destination?.status === 'sign_in_required' ? <Text variant="bodySmall" color="gray">Sign in again</Text> : null}
              </Box>
              </Box>
            </Pressable>
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel={`Remove saved account ${account.subject}`}
              onPress={() => onRemove(account)}
            >
              <Box className="account-menu-remove" justifyContent="center">
                <Text variant="bodySmall" color="danger">Remove</Text>
              </Box>
            </Pressable>
          </Box>
        );
      })}
    </>
  );
}
