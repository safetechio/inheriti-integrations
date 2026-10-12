import type { GlobalProvider } from '@ladle/react';
import { Box } from '@main-components';
import '../src/styles.css';

export const Provider: GlobalProvider = ({ children }) => (
  <Box backgroundColor="primary5" minHeight="100%" style={{ minHeight: '100vh' }}>
    {children}
  </Box>
);
