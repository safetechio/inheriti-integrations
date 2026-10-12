import type { ReactNode } from 'react';
import { Box, Text, theme, type BoxProps } from '@modules/_shared/ui/components/Primitives';
import { Icon } from '@modules/_shared/ui/components/Base/Icon';

export type BadgeTone = 'primary' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';
export type BadgeVariant = 'solid' | 'soft' | 'outline' | 'metadata' | 'count';
export type BadgeSize = 'sm' | 'md' | 'lg';
export type BadgeEmphasis = 'default' | 'selected';

type BadgeProps = Omit<BoxProps, 'children'> & {
  children: ReactNode;
  tone?: BadgeTone;
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: string;
  iconSize?: number;
  uppercase?: boolean;
  emphasis?: BadgeEmphasis;
};

const toneBase = {
  primary: 'primary',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  neutral: 'gray',
} as const;

function colorToken(tone: BadgeTone, suffix: string): keyof typeof theme.colors {
  const base = toneBase[tone];
  return `${base}${suffix}` as keyof typeof theme.colors;
}

const textVariantBySize = {
  sm: 'badgeSm',
  md: 'badgeMd',
  lg: 'badgeLg',
} as const;

export function Badge({
  children,
  tone = 'neutral',
  variant = 'soft',
  size = 'md',
  icon,
  iconSize,
  uppercase = false,
  emphasis = 'default',
  style,
  ...props
}: BadgeProps) {
  const solid = variant === 'solid';
  const metadata = variant === 'metadata';
  const count = variant === 'count';
  const outline = variant === 'outline';
  const dimensions = theme.importer.badges[size];
  const textVariant = metadata
    ? 'badgeMetadata'
    : count
      ? 'badgeCount'
      : emphasis === 'selected'
        ? 'badgeSelected'
        : textVariantBySize[size];
  const backgroundColor = solid
    ? toneBase[tone]
    : metadata
      ? 'transparent'
      : outline
        ? 'white'
        : colorToken(tone, '10');
  const borderColor = solid ? toneBase[tone] : metadata ? 'transparent' : colorToken(tone, '30');
  const foregroundColor = solid ? 'white' : colorToken(tone, '120');

  return (
    <Box
      {...props}
      flexDirection="row"
      alignItems="center"
      justifyContent="center"
      gap="xs"
      paddingHorizontal={
        count ? theme.importer.badges.count.paddingInline : metadata ? 0 : dimensions.paddingInline
      }
      paddingVertical={
        count ? theme.importer.badges.count.paddingBlock : metadata ? 0 : dimensions.paddingBlock
      }
      borderWidth={metadata ? 0 : 1}
      borderRadius="pill"
      backgroundColor={backgroundColor}
      borderColor={borderColor}
      style={[
        {
          minHeight: count
            ? theme.importer.badges.count.minHeight
            : metadata
              ? theme.importer.badges.metadataMinHeight
              : dimensions.minHeight,
        },
        style,
      ]}
    >
      {icon ? (
        <Icon
          name={icon}
          size={iconSize ?? dimensions.iconSize}
          color={theme.colors[foregroundColor]}
        />
      ) : null}
      <Text variant={textVariant} color={foregroundColor} uppercase={uppercase}>
        {children}
      </Text>
    </Box>
  );
}

export type { BadgeProps };
export default Badge;
