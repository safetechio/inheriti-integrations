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
  variant?: 'pill' | 'tab';
  count?: number;
}

export function FilterChip({
  children,
  selected = false,
  disabled = false,
  onPress,
  className,
  variant = 'pill',
  count,
}: FilterChipProps) {
  const theme = useTheme();
  const handlePress = disabled ? undefined : onPress;
  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="button"
      aria-pressed={selected}
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
        flexDirection="row"
        alignItems="center"
        gap="s"
        style={
          variant === 'tab'
            ? {
                borderRadius: 0,
                borderWidth: 0,
                borderBottomWidth: 2,
                borderBottomColor: selected ? theme.colors.primary : 'transparent',
                backgroundColor: 'transparent',
                minHeight: 44,
              }
            : undefined
        }
      >
        <Text
          variant={variant === 'tab' ? 'bodyRegular' : 'filterChip'}
          color={selected ? 'primary120' : 'gray'}
        >
          {children}
        </Text>
        {count !== undefined ? (
          <Box
            borderWidth={1}
            borderColor={selected ? 'primary30' : 'gray10'}
            borderRadius="pill"
            paddingHorizontal="s"
          >
            <Text variant="bodySmall" color={selected ? 'primary120' : 'gray'}>
              {count}
            </Text>
          </Box>
        ) : null}
      </Box>
    </Pressable>
  );
}

export default FilterChip;
