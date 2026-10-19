export const authFetch: typeof fetch = (input, init) => fetch(input, {
  ...init,
  signal: init?.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(60_000)])
    : AbortSignal.timeout(60_000),
});
