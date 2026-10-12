/**
 * Test-only stub for `@safetech/safekey-sdk`, mirroring the Business Client
 * Core SDK's own `tests/stubs/safekey-sdk.ts`. The asset metadata
 * subpath eagerly imports Core's `/core` bundle, which statically imports
 * this package even for logic-only exports (Asset editor state/validation)
 * that never call it. The real package resolves via extensionless internal
 * imports (`dist/js/ext_storage`) that plain Node ESM / Vite dependency
 * externalization cannot follow, even once installed — a real webpack/Vite
 * app build (this app's own `vite build`) resolves it fine; only the
 * externalized module-graph walk vitest/vite-node does for `node_modules`
 * cannot. Aliased in `vite.config.ts` so any Importer test importing
 * `.../components/assets` can load without pulling in real SafeKey device I/O.
 */
export function write(): never {
  throw new Error('safekey-sdk stub: write() is not implemented under test');
}
export function read(): never {
  throw new Error('safekey-sdk stub: read() is not implemented under test');
}
export function freeSlots(): never {
  throw new Error('safekey-sdk stub: freeSlots() is not implemented under test');
}
export function remove(): never {
  throw new Error('safekey-sdk stub: remove() is not implemented under test');
}
export function logOut(): never {
  throw new Error('safekey-sdk stub: logOut() is not implemented under test');
}
export function listKeys(): never {
  throw new Error('safekey-sdk stub: listKeys() is not implemented under test');
}
