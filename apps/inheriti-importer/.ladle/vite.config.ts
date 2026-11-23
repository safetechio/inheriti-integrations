import { defineConfig, mergeConfig } from 'vite';
import importerConfig from '../vite.config';

export default defineConfig((environment) =>
  mergeConfig(importerConfig(environment), { cacheDir: 'node_modules/.vite-ladle' }),
);
