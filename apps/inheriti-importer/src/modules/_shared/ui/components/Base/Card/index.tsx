import type { ReactNode } from 'react';
import { Box, type BoxProps, type Theme } from '@modules/_shared/ui/components/Primitives';

type CardTone = 'default' | 'selected' | 'danger';

export interface CardProps extends BoxProps {
  children: ReactNode;
  tone?: CardTone;
}

const BORDER: Record<CardTone, keyof Theme['colors']> = {
  default: 'primary30',
  selected: 'primary',
  danger: 'danger',
};

const BACKGROUND: Record<CardTone, keyof Theme['colors']> = {
  default: 'white',
  selected: 'primary10',
  danger: 'white',
};

/** Bordered surface on the shared tokens — radius `s`, 1px token border. */
export function Card({ children, tone = 'default', ...rest }: CardProps) {
  return (
    <Box
      padding="m"
      gap="s"
      borderRadius="s"
      borderWidth={1}
      borderColor={BORDER[tone]}
      backgroundColor={BACKGROUND[tone]}
      {...rest}
    >
      {children}
    </Box>
  );
}

export default Card;
