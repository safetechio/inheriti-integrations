/**
 * The Chrome host runs in a browser, and `safekey-sdk` reads `window` at module scope. The workspace
 * runs vitest under Node, so the globals a browser would already have are supplied here rather than
 * pulling in a full DOM implementation for what these tests actually need.
 */
const browserGlobals = globalThis as Record<string, unknown>;
browserGlobals.window ??= globalThis;
browserGlobals.navigator ??= { userAgent: 'vitest' };
