import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertEnvironment, runPnpm } from './environment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = process.argv[2];
assertEnvironment(environment);

await runPnpm(['run', `build:${environment}`], { cwd: root });
await runPnpm(['exec', 'electron-builder', '--config', 'electron-builder.config.cjs', '--publish', 'never'], {
  cwd: root,
  env: Object.assign({}, process.env, { INHERITI_RELEASE_ENV: environment }),
});
