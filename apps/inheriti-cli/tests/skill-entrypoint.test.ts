import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

const execute = promisify(execFile);

it('repairs the selected skill through the update entrypoint without a lifecycle event', async () => {
  const app = fileURLToPath(new URL('..', import.meta.url));
  const cache = join(app, 'node_modules', '.cache');
  await mkdir(cache, { recursive: true });
  const root = await mkdtemp(join(cache, 'skill-entrypoint-'));
  try {
    const entry = join(root, 'dist', 'main.js');
    await build({ entryPoints: [join(app, 'src', 'main.ts')], outfile: entry, bundle: true,
      packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' });
    await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module', version: '1.0.0' }));
    const source = join(root, 'skill', 'inheriti-cli');
    await mkdir(source, { recursive: true });
    const content = '# Test skill\n';
    await writeFile(join(source, 'SKILL.md'), content);
    await writeFile(join(root, 'skill', 'manifest.json'), JSON.stringify({ schema: 1, cliVersion: '1.0.0', deployment: 'dev',
      sha256: createHash('sha256').update('SKILL.md\0').update(content).update('\0').digest('hex') }));
    const env = { ...process.env, CI: '', SUDO_USER: '', HOME: root, XDG_CONFIG_HOME: join(root, 'config'),
      INHERITI_ELEMENTS_CONFIG: join(root, 'config', 'inheriti', 'config.json'),
      CODEX_HOME: join(root, '.codex'), CLAUDE_CONFIG_DIR: join(root, '.claude'), npm_lifecycle_event: '' };
    await execute(process.execPath, [entry, 'skill', 'install', '--target', 'claude'], { env });
    const target = join(root, '.claude', 'skills', 'inheriti-cli');
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe(content);
    await rm(target, { recursive: true });
    await execute(process.execPath, [entry, '__skill-install'], { env });
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe(content);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
