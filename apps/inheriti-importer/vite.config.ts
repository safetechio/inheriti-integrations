import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The Importer owns its interface components and styling. `react-native` is
// resolved to `react-native-web` for the local primitive wrappers.
export default defineConfig(({ mode }) => {
  // Release builds select `.env.dev`, `.env.stg`, or `.env.prod`. The build
  // script also writes the selected main-process values into dist so both
  // Electron processes use the same environment.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    base: './',
    define: {
      global: 'globalThis',
      __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
      __API_ORIGIN__: JSON.stringify(env.INHERITI_API_ORIGIN || ''),
      __WEB_APP_URL__: JSON.stringify(env.WEB_APP_URL || 'http://localhost:8081'),
    },
    resolve: {
      // The linked SDK ships its own nested copies of these under its own
      // node_modules; without deduping, its components get a different
      // module instance than the app's own providers use, so React context
      // (e.g. QueryClientProvider) never reaches its consumers.
      dedupe: ['react', 'react-dom', '@tanstack/react-query'],
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@modules': path.resolve(__dirname, 'src/modules'),
        '@shared': path.resolve(__dirname, 'src/modules/_shared'),
        '@main-components': path.resolve(__dirname, 'src/modules/_shared/ui/components'),
        '@utils': path.resolve(__dirname, 'src/modules/_shared/domain/utils'),
        '@assets': path.resolve(__dirname, 'src/assets'),
        'react-native': 'react-native-web',
        // Test-only: see tests/stubs/safekey-sdk.ts. Vite's real `build`
        // resolves the real package's extensionless internal imports fine;
        // only vitest/vite-node's externalized `node_modules` walk cannot.
        ...(mode === 'test'
          ? { '@safetech/safekey-sdk': path.resolve(__dirname, 'tests/stubs/safekey-sdk.ts') }
          : {}),
      },
      extensions: [
        '.web.tsx',
        '.web.ts',
        '.web.jsx',
        '.web.js',
        '.tsx',
        '.ts',
        '.jsx',
        '.js',
        '.json',
      ],
    },
    optimizeDeps: {
      include: ['react-native-web'],
      exclude: ['@ladle/react'],
      esbuildOptions: {
        loader: { '.js': 'jsx' },
      },
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    },
    test: {
      environment: 'node',
      environmentMatchGlobs: [['tests/**/*.test.tsx', 'jsdom']],
      include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
      server: {
        // Force these through Vite's resolver (so the alias above applies)
        // instead of vitest/vite-node's default `node_modules` externalization.
        deps: { inline: [/@safetech\/inheriti-core-sdk/, /@safetech\/safekey-sdk/] },
      },
    },
  };
});
