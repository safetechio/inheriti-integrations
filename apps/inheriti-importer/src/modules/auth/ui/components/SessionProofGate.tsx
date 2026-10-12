import { useEffect, useRef, type ReactNode } from 'react';
import { ActivityIndicator, Box, Text } from '@modules/_shared/ui/components';
import Button from '@modules/_shared/ui/components/Base/Button';
import { useTheme } from '@modules/_shared/ui/theme/AppTheme';
import {
  deriveSessionProofStatus,
  type SessionProofStatus,
} from '@modules/auth/application/derive-session-proof-status';
import useOnlineStatus from '@modules/auth/application/use-online-status';
import {
  useAuthenticatedCookieSession,
  type AuthSessionStatus,
} from '@shared/infrastructure/importer-api';

const SESSION_PROOF_COPY: Record<
  Exclude<SessionProofStatus, 'ready'>,
  { title: string; message: string; action: 'retry' | 'sign-in' | null }
> = {
  checking: { title: 'Checking your session…', message: '', action: null },
  expired: {
    title: 'Session expired',
    message: 'Your session has expired. Sign in again to continue.',
    action: 'sign-in',
  },
  replaced: {
    title: 'Signed out elsewhere',
    message: 'This account was signed in from another window. Sign in again to continue here.',
    action: 'sign-in',
  },
  offline: {
    title: 'You are offline',
    message: 'Reconnect to the internet, then retry.',
    action: 'retry',
  },
  error: {
    title: 'Could not verify your session',
    message: 'Something went wrong confirming your session with the server.',
    action: 'retry',
  },
};

export default function SessionProofGate({
  children,
  onSignOut,
}: {
  children: ReactNode;
  onSignOut: () => void;
}) {
  const uiTheme = useTheme();
  const { status: cookieStatus, confirmSession } = useAuthenticatedCookieSession();
  const isOnline = useOnlineStatus();
  const previousCookieStatusRef = useRef<AuthSessionStatus | null>(null);
  const proofStatus = deriveSessionProofStatus({
    cookieStatus,
    previousCookieStatus: previousCookieStatusRef.current,
    isOnline,
  });
  useEffect(() => {
    previousCookieStatusRef.current = cookieStatus;
  }, [cookieStatus]);
  if (proofStatus === 'ready') return <>{children}</>;
  const view = SESSION_PROOF_COPY[proofStatus];
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
        alignItems="center"
        style={{
          borderColor: uiTheme.colors.gray10,
          borderRadius: uiTheme.radii.m,
          borderWidth: 1,
          padding: uiTheme.spacing.xxl,
          boxShadow: '0 8px 28px rgba(16, 24, 40, 0.08)',
        }}
      >
        {proofStatus === 'checking' ? (
          <ActivityIndicator size="small" color={uiTheme.colors.gray30} />
        ) : null}
        <Text variant="heading3" align="center">
          {view.title}
        </Text>
        {view.message ? (
          <Text variant="bodySmall" align="center" color="gray">
            {view.message}
          </Text>
        ) : null}
        {view.action === 'retry' ? (
          <Button
            title="Retry"
            block
            onPress={() => {
              void confirmSession();
            }}
          />
        ) : null}
        {view.action === 'sign-in' ? (
          <Button title="Sign in again" block onPress={onSignOut} />
        ) : null}
      </Box>
    </Box>
  );
}
