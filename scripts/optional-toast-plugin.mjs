/**
 * Keeps the Core SDK's optional toast dependency out of a host bundle.
 *
 * Core reaches for `sonner` through a guarded `import('sonner').catch(() => undefined)` and every use
 * site is `if (toast)` / `toast?.error(...)`, so a host that cannot render a toast is a supported
 * state. esbuild still resolves dynamic imports statically, though, so bundling drags in sonner and
 * with it react and react-dom — neither of which a service worker or an extension host has.
 *
 * Stubbing it with a module that throws makes the dynamic import reject, which is the branch Core
 * already handles. Returning an empty module would not: the resolved namespace object is truthy, so
 * the `if (toast)` guard would pass and the call would fail at the point of use instead.
 */
export const optionalToastPlugin = {
  name: 'stub-optional-toast',
  setup(build) {
    build.onResolve({ filter: /^sonner$/ }, () => ({ path: 'sonner', namespace: 'optional-toast' }));
    build.onLoad({ filter: /.*/, namespace: 'optional-toast' }, () => ({
      contents: "throw new Error('optional_toast_unavailable');",
      loader: 'js',
    }));
  },
};
