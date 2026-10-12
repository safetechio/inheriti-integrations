import { Box, theme, type BoxProps } from '@modules/_shared/ui/components/Primitives';
import type { Theme } from '@modules/_shared/ui/theme/AppTheme';

export type ProgressBarTone = 'success' | 'warning' | 'danger' | 'primary';

export interface ProgressBarProps extends Omit<BoxProps, 'children'> {
  value: number;
  max?: number;
  tone?: ProgressBarTone;
  label?: string;
  fillClassName?: string;
}

const fillColor: Record<ProgressBarTone, keyof Theme['colors']> = {
  success: 'success',
  warning: 'warning120',
  danger: 'danger120',
  primary: 'primary',
};

export function ProgressBar({
  value,
  max = 100,
  tone = 'success',
  label,
  fillClassName,
  className,
  ...rest
}: ProgressBarProps) {
  const safeMax = max > 0 ? max : 100;
  const safeValue = Math.min(safeMax, Math.max(0, value));
  const percentage = (safeValue / safeMax) * 100;
  return (
    <Box
      {...rest}
      className={className}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: safeMax, now: safeValue }}
      height={theme.spacing.xs}
      borderRadius="pill"
      overflow="hidden"
      backgroundColor="gray10"
    >
      <Box
        className={fillClassName}
        height="100%"
        borderRadius="pill"
        backgroundColor={fillColor[tone]}
        style={{ width: `${percentage}%` }}
      />
    </Box>
  );
}

export type MeterProps = ProgressBarProps;
export const Meter = ProgressBar;

export default ProgressBar;
