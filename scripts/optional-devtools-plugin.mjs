/**
 * Keeps Ink's React DevTools bridge out of a bundled host.
 *
 * Ink only reaches for it when `DEV=true`, behind an `import.meta.resolve` check for a package that
 * is not installed here — but esbuild resolves the `await import('./devtools.js')` statically anyway,
 * and that module pulls in `react-devtools-core` and a WebSocket client neither of which a shipped
 * CLI has any use for.
 *
 * Stubbing the module with one that throws keeps the DEV branch honest: a bundled CLI cannot attach
 * a devtools session, and says so, rather than silently doing nothing.
 */
export const optionalDevtoolsPlugin = {
  name: 'stub-ink-devtools',
  setup(build) {
    build.onResolve({ filter: /^\.\/devtools\.js$/ }, (args) => {
      if (!/[\\/]ink[\\/]build[\\/]/.test(args.importer)) return undefined;
      return { path: 'ink-devtools', namespace: 'optional-devtools' };
    });
    build.onLoad({ filter: /.*/, namespace: 'optional-devtools' }, () => ({
      contents: "throw new Error('ink_devtools_unavailable_in_a_bundled_cli');",
      loader: 'js',
    }));
  },
};
