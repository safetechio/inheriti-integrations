export default {
  viteConfig: '.ladle/vite.config.ts',
  stories: ['src/**/*.stories.@(ts|tsx|js|jsx)'],
  ...(process.env.INHERITI_VISUAL_CATALOG === '1' ? { hmrHost: '127.0.0.1', hmrPort: 6111 } : {}),
};
