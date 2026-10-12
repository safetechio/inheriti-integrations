import type { ReactNode } from 'react';
import { Box, type BoxProps, type Theme } from '@modules/_shared/ui/components/Primitives';

export interface StackProps extends Omit<BoxProps, 'flexDirection'> {
  children: ReactNode;
  direction?: 'column' | 'row';
  gap?: keyof Theme['spacing'];
}

/** Flex container with a token gap. `direction` defaults to `column`. */
export function Stack({ children, direction = 'column', gap = 'm', ...rest }: StackProps) {
  return (
    <Box flexDirection={direction} gap={gap} {...rest}>
      {children}
    </Box>
  );
}

export default Stack;
