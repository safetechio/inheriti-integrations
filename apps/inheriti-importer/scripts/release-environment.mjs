import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertEnvironment, runYarn } from './environment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = process.argv[2];
assertEnvironment(environment);

await runYarn([`build:${environment}`], { cwd: root });
await runYarn(['electron-builder', '--config', 'electron-builder.config.cjs', '--publish', 'never'], {
  cwd: root,
  env: Object.assign({}, process.env, { INHERITI_RELEASE_ENV: environment }),
});
