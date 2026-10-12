import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Box,
  Pressable,
  Text,
  type Theme,
} from '@modules/_shared/ui/components/Primitives';
import { useTheme } from '@modules/_shared/ui/theme/AppTheme';
import { keyboardActivation } from '@modules/_shared/ui/keyboard-activation';

type ButtonVariant = 'contained' | 'outlined' | 'plain';
type ButtonSize = 'sm' | 'md' | 'lg';
type ButtonColor = 'primary' | 'danger' | 'success' | 'warning' | 'info' | 'gray';

export interface ButtonProps {
  title: ReactNode;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  color?: ButtonColor;
  disabled?: boolean;
  loading?: boolean;
  block?: boolean;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  testID?: string;
  accessibilityLabel?: string;
  minHeight?: number;
  paddingHorizontal?: number | keyof Theme['spacing'];
  textVariant?: keyof Theme['textVariants'];
}

const PADDING_X: Record<ButtonSize, keyof Theme['spacing']> = { sm: 's', md: 'm', lg: 'l' };
const TEXT_VARIANT: Record<ButtonSize, keyof Theme['textVariants']> = {
  sm: 'buttonSmall',
  md: 'buttonDefault',
  lg: 'buttonLarge',
};

function token(color: ButtonColor, suffix: string): keyof Theme['colors'] {
  return (suffix ? `${color}${suffix}` : color) as keyof Theme['colors'];
}

interface Surface {
  backgroundColor: keyof Theme['colors'];
  borderColor: keyof Theme['colors'];
  labelColor: keyof Theme['colors'];
}

function resolveSurface(variant: ButtonVariant, color: ButtonColor, disabled: boolean): Surface {
  if (variant === 'contained') {
    return {
      backgroundColor: disabled ? token(color, '30') : token(color, ''),
      borderColor: disabled ? token(color, '30') : token(color, ''),
      labelColor: 'white',
    };
  }

  if (variant === 'outlined') {
    return {
      backgroundColor: 'white',
      borderColor: disabled ? token(color, '10') : token(color, '30'),
      labelColor: disabled ? token(color, '30') : token(color, '120'),
    };
  }

  return {
    backgroundColor: 'white',
    borderColor: 'white',
    labelColor: disabled ? token(color, '30') : token(color, '120'),
  };
}

export function Button({
  title,
  onPress,
  variant = 'contained',
  size = 'md',
  color = 'primary',
  disabled = false,
  loading = false,
  block = false,
  startIcon,
  endIcon,
  testID,
  accessibilityLabel,
  minHeight,
  paddingHorizontal,
  textVariant,
}: ButtonProps) {
  const uiTheme = useTheme();
  const isDisabled = disabled || loading;
  const surface = resolveSurface(variant, color, isDisabled);
  const label = accessibilityLabel ?? (typeof title === 'string' ? title : undefined);
  const height = {
    sm: uiTheme.importer.controls.smallHeight,
    md: uiTheme.importer.controls.defaultHeight,
    lg: uiTheme.importer.controls.largeHeight,
  }[size];

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={block ? { alignSelf: 'stretch' } : undefined}
      {...(isDisabled ? {} : keyboardActivation(onPress))}
    >
      <Box
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        gap="s"
        minHeight={minHeight ?? height}
        paddingHorizontal={paddingHorizontal ?? PADDING_X[size]}
        borderRadius={size === 'lg' ? uiTheme.radii.m : uiTheme.radii.s}
        borderWidth={1}
        borderColor={surface.borderColor}
        backgroundColor={surface.backgroundColor}
        alignSelf={block ? 'stretch' : 'flex-start'}
        opacity={isDisabled ? 0.75 : 1}
      >
        {loading ? (
          <ActivityIndicator size="small" color={uiTheme.colors[surface.labelColor]} />
        ) : (
          startIcon
        )}
        <Text variant={textVariant ?? TEXT_VARIANT[size]} color={surface.labelColor}>
          {title}
        </Text>
        {loading ? null : endIcon}
      </Box>
    </Pressable>
  );
}

export default Button;
