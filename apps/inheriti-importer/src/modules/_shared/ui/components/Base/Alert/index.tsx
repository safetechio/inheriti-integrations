import { useState, type ReactNode } from 'react';
import { Box, Pressable, Text } from '@modules/_shared/ui/components/Primitives';
import { Icon } from '@modules/_shared/ui/components/Base/Icon';
import { useTheme, type Theme } from '@modules/_shared/ui/theme/AppTheme';

export type AlertTone = 'danger' | 'warning' | 'info' | 'success';

const TONE_TOKENS: Record<
  AlertTone,
  { background: keyof Theme['colors']; border: keyof Theme['colors']; text: keyof Theme['colors'] }
> = {
  danger: { background: 'danger10', border: 'danger30', text: 'danger120' },
  warning: { background: 'warning10', border: 'warning30', text: 'warning200' },
  info: { background: 'info10', border: 'info30', text: 'info120' },
  success: { background: 'success10', border: 'success30', text: 'success120' },
};

export function Alert({
  children,
  tone = 'danger',
  dismissable = true,
}: {
  children: ReactNode;
  tone?: AlertTone;
  dismissable?: boolean;
}) {
  const uiTheme = useTheme();
  const tokens = TONE_TOKENS[tone];
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  return (
    <Box
      accessibilityRole="alert"
      padding="s"
      borderWidth={1}
      borderRadius={uiTheme.radii.s}
      backgroundColor={tokens.background}
      borderColor={tokens.border}
    >
      <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap="s">
        <Text variant="bodySmall" color={tokens.text} style={{ flex: 1 }}>
          {children}
        </Text>
        {dismissable ? (
          <Pressable
            accessibilityLabel="Dismiss alert"
            onPress={() => setVisible(false)}
            style={{ padding: 4 }}
          >
            <Icon
              name="xmark"
              size={20}
              color={uiTheme.colors[tokens.text]}
              label="Dismiss alert"
            />
          </Pressable>
        ) : null}
      </Box>
    </Box>
  );
}

export default Alert;
