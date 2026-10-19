import { copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnvironment, runPnpm } from './environment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = process.argv[2];
const runtimeEnvironment = readEnvironment(environment, root);

await runPnpm(['exec', 'tsc', '-b'], { cwd: root });
await runPnpm(['exec', 'vite', 'build', '--mode', environment], { cwd: root });
await copyFile(path.join(root, '../../packages/core/assets/font-app.ttf'), path.join(root, 'dist/font-app.ttf'));
await writeFile(
  path.join(root, 'dist', 'runtime-environment.json'),
  `${JSON.stringify(runtimeEnvironment, null, 2)}\n`,
  'utf8',
);
