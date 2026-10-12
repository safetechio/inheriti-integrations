import type { ReactNode } from 'react';
import { Box, Pressable, type BoxProps } from '@modules/_shared/ui/components/Primitives';
import { keyboardActivation } from '@modules/_shared/ui/keyboard-activation';

export interface InteractiveSurfaceProps extends Omit<BoxProps, 'children'> {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}

export function InteractiveSurface({
  children,
  onPress,
  disabled = false,
  accessibilityLabel,
  ...surfaceProps
}: InteractiveSurfaceProps) {
  const handlePress = disabled ? undefined : onPress;
  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      {...(handlePress ? keyboardActivation(handlePress) : {})}
    >
      <Box {...surfaceProps} opacity={disabled ? 0.6 : surfaceProps.opacity}>
        {children}
      </Box>
    </Pressable>
  );
}

export default InteractiveSurface;
