import type { ReactNode } from 'react';
import { Box, Pressable, Text } from '@modules/_shared/ui/components/Primitives';
import { useTheme } from '@modules/_shared/ui/theme/AppTheme';
import { keyboardActivation } from '@modules/_shared/ui/keyboard-activation';

export interface FilterChipProps {
  children: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  className?: string;
}

export function FilterChip({
  children,
  selected = false,
  disabled = false,
  onPress,
  className,
}: FilterChipProps) {
  const theme = useTheme();
  const handlePress = disabled ? undefined : onPress;
  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="button"
      {...(handlePress ? keyboardActivation(handlePress) : {})}
    >
      <Box
        className={className}
        paddingHorizontal={theme.importer.spacing.sectionGap}
        paddingVertical="xs"
        borderWidth={1}
        borderRadius="pill"
        borderColor={selected ? 'primary' : 'gray30'}
        backgroundColor={selected ? 'primary10' : 'white'}
        opacity={disabled ? 0.55 : 1}
      >
        <Text variant="filterChip" color={selected ? 'primary120' : 'gray'}>
          {children}
        </Text>
      </Box>
    </Pressable>
  );
}

export default FilterChip;
