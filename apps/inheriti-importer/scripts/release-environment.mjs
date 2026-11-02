import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertEnvironment, runYarn } from './environment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = process.argv[2];
assertEnvironment(environment);

await runYarn([`build:${environment}`], { cwd: root });
execFileSync(
  process.execPath,
  [
    path.join(root, 'node_modules/electron-builder/cli.js'),
    '--config',
    'electron-builder.config.cjs',
    '--publish',
    'never',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: Object.assign({}, process.env, {
      INHERITI_RELEASE_ENV: environment,
      npm_config_user_agent: 'pnpm',
      COREPACK_ENABLE_PROJECT_SPEC: '1',
    }),
  },
);
