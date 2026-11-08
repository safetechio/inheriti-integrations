import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../packages/core/package.json', import.meta.url)));
for (const [name, version] of [
  ['@safetech/inheriti-client-sdk', '1.17.31'],
  ['@safetech/inheriti-core-sdk', '4.0.40'],
]) {
  if (manifest.dependencies?.[name] !== version) {
    throw new Error(`${name} must be the exact registry version ${version}`);
  }
  const installed = JSON.parse(
    await readFile(new URL(`../packages/core/node_modules/${name}/package.json`, import.meta.url)),
  );
  if (installed.version !== version) {
    throw new Error(`${name} is installed at ${installed.version}; expected ${version}`);
  }
}
