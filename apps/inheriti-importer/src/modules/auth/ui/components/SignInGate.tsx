import { useTheme } from '@modules/_shared/ui/theme/AppTheme';
import { ActivityIndicator, Alert, Box, Text } from '@modules/_shared/ui/components';
import Button from '@modules/_shared/ui/components/Base/Button';
import { BrandLogo } from '@modules/import/ui/components/BrandLogo';
import type { SavedAccount } from '@modules/auth/infrastructure/electron-auth-provider';

export interface SignInGateProps {
  status: 'checking' | 'switching' | 'signed-out' | 'signed-in' | 'error';
  message: string | null;
  loginInProgress: boolean;
  accounts: SavedAccount[];
  onActivateAccount: (key: string) => Promise<void>;
  onLogin: () => Promise<void>;
  onCancel: () => Promise<void>;
}

export function SignInGate({
  status,
  message,
  loginInProgress,
  accounts,
  onActivateAccount,
  onLogin,
  onCancel,
}: SignInGateProps) {
  const uiTheme = useTheme();
  return (
    <Box
      flex={1}
      position="absolute"
      top={0}
      right={0}
      bottom={0}
      left={0}
      justifyContent="center"
      alignItems="center"
      padding="l"
    >
      <Box
        gap="m"
        maxWidth={440}
        width="100%"
        backgroundColor="white"
        style={{
          borderColor: uiTheme.colors.gray10,
          borderRadius: uiTheme.radii.m,
          borderWidth: 1,
          padding: uiTheme.spacing.xxl,
          boxShadow: '0 8px 28px rgba(16, 24, 40, 0.08)',
        }}
      >
        {status === 'switching' ? (
          <Box alignItems="center" gap="s" role="status" aria-live="polite" aria-busy={true}>
            <ActivityIndicator size="small" color={uiTheme.colors.gray30} />
            <Text variant="heading3" align="center">
              Switching account…
            </Text>
          </Box>
        ) : null}
        {status !== 'switching' ? <BrandLogo className="auth-logo" /> : null}
        {status !== 'switching' ? (
          <Box gap="s" className="auth-copy">
            <Text variant="heading3" align="center">
              Sign in to your workspace
            </Text>
            <Text variant="bodySmall" align="center" color="gray">
              Import your secrets, review them, and create secure plans for your organisation.
            </Text>
          </Box>
        ) : null}
        {status === 'checking' ? (
          <Box alignItems="center" gap="s">
            <ActivityIndicator size="small" color={uiTheme.colors.gray30} />
            {loginInProgress ? (
              <Button
                title="Cancel"
                variant="plain"
                size="sm"
                onPress={() => {
                  void onCancel();
                }}
              />
            ) : null}
          </Box>
        ) : null}
        {status !== 'switching' && message ? <Alert>{message}</Alert> : null}
        {status !== 'checking' &&
          status !== 'switching' &&
          accounts.map((account, index) => (
            <Button
              key={account.key}
              title={`Continue with saved account${accounts.length > 1 ? ` ${index + 1}` : ''}`}
              variant="outlined"
              block
              onPress={() => {
                void onActivateAccount(account.key);
              }}
            />
          ))}
        {status !== 'checking' && status !== 'switching' ? (
          <Button
            title="Sign in with SafeID"
            block
            onPress={() => {
              void onLogin();
            }}
          />
        ) : null}
      </Box>
    </Box>
  );
}
