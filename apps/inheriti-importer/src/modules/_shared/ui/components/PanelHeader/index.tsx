import type { ReactNode } from 'react';
import { Box, Text } from '@modules/_shared/ui/components/Primitives';

export function PanelHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Box
      className="mw-panel-header"
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      gap="m"
    >
      <Box gap="xs" flex={1}>
        <Text variant="heading3">{title}</Text>
        {description ? (
          <Text variant="bodySmall" color="gray">
            {description}
          </Text>
        ) : null}
        {children}
      </Box>
      {actions ? (
        <Box flexDirection="row" alignItems="center" gap="s">
          {actions}
        </Box>
      ) : null}
    </Box>
  );
}
