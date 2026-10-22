import { afterEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const configPath = fileURLToPath(new URL('../../electron-builder.config.cjs', import.meta.url));
const baseVersion = require('../../package.json').version;
const original = process.env.INHERITI_RELEASE_ENV;

afterEach(() => {
  if (original === undefined) delete process.env.INHERITI_RELEASE_ENV;
  else process.env.INHERITI_RELEASE_ENV = original;
  delete require.cache[configPath];
});

it.each([
  ['dev', `${baseVersion}-dev.0`],
  ['stg', `${baseVersion}-stg.0`],
  ['prod', baseVersion],
])('packages %s with version %s', (environment, version) => {
  process.env.INHERITI_RELEASE_ENV = environment;
  delete require.cache[configPath];
  const config = require(configPath);
  expect(config.extraMetadata.version).toBe(version);
  expect(config.artifactName).toBe(`Inheriti-Importer-${environment === 'prod' ? '' : `${environment}-`}\${version}-\${os}-\${arch}.\${ext}`);
});
