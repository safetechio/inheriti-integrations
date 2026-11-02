import { copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readEnvironment, runYarn } from './environment.mjs';
import '../../../scripts/assert-registry-sdk.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = process.argv[2];
const runtimeEnvironment = readEnvironment(environment, root);

await runYarn(['tsc', '-b'], { cwd: root });
await runYarn(['vite', 'build', '--mode', environment], { cwd: root });
await build({
  entryPoints: [path.join(root, '../../packages/core/dist/node.js')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  external: [
    '@safetech/inheriti-core-sdk',
    '@safetech/inheriti-core-sdk/*',
    '@safetech/safekey-sdk',
    '@safetech/safekey-sdk/*',
  ],
  outfile: path.join(root, 'dist/operator-core.mjs'),
});
await copyFile(
  path.join(root, '../../packages/core/assets/font-app.ttf'),
  path.join(root, 'dist/font-app.ttf'),
);
await writeFile(
  path.join(root, 'dist', 'runtime-environment.json'),
  `${JSON.stringify(runtimeEnvironment, null, 2)}\n`,
  'utf8',
);
