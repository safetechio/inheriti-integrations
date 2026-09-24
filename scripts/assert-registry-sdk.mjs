import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../packages/core/package.json', import.meta.url)));
if (manifest.dependencies?.['@safetech/inheriti-client-sdk'] !== '1.17.12') {
  throw new Error('@safetech/inheriti-client-sdk must be the exact registry version 1.17.12');
}
