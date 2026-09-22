import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    passWithNoTests: false,
    restoreMocks: true,
    server: {
      deps: {
        inline: [/@safetech\//],
      },
    },
  },
});
