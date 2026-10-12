import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertEnvironment, runPnpm } from './environment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = process.argv[2];
assertEnvironment(environment);

await runPnpm(
  [
    'exec',
    'concurrently',
    '-k',
    `vite --mode ${environment}`,
    'wait-on http://127.0.0.1:5173 && electron .',
  ],
  {
    cwd: root,
    env: Object.assign({}, process.env, { INHERITI_ENV: environment }),
  },
);
