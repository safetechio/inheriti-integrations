import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const artifactDirectory = resolve(process.cwd(), 'artifacts');
mkdirSync(artifactDirectory, { recursive: true });
const result = spawnSync('pnpm', ['pack', '--pack-destination', artifactDirectory], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

if (result.status !== 0) process.exit(result.status ?? 1);
