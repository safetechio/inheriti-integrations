import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { setup } from '../src/commands/setup.js';
import { completionInstallPath, installCompletion } from '../src/completion/install.js';

const homes: string[] = [];
async function home(): Promise<string> {
  const path = await mkdtemp(resolve(tmpdir(), 'inheriti-setup-'));
  homes.push(path);
  return path;
}
afterEach(async () => { await Promise.all(homes.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const terminal = (interactive = true) => ({ stdoutIsTTY: false, interactive, columns: 80, write: vi.fn(), writeError: vi.fn() });

it('offers Yes first, shows the path, and appends only once while preserving shell text', async () => {
  const HOME = await home();
  const path = await completionInstallPath('bash', { HOME });
  await writeFile(path, 'export CUSTOM=yes');
  const select = vi.fn().mockResolvedValue('yes');
  const output = terminal();
  expect(await setup([], { HOME, SHELL: '/bin/bash' }, output, select)).toBe(0);
  expect(output.write).toHaveBeenCalledWith(`Shell autocomplete file: ${path}`);
  expect(select.mock.calls[0]?.[1]?.[0]?.value).toBe('yes');
  const installed = await readFile(path, 'utf8');
  expect(installed).toContain('export CUSTOM=yes\n# inheriti shell completion');
  expect(await setup(['--yes'], { HOME, SHELL: '/bin/bash' }, output)).toBe(0);
  expect(await readFile(path, 'utf8')).toBe(installed);
});

it('No, noninteractive, CI and explicit skip never write files', async () => {
  const HOME = await home();
  const env = { HOME, SHELL: '/bin/bash' };
  expect(await setup([], env, terminal(), vi.fn().mockResolvedValue('no'))).toBe(0);
  expect(await setup([], env, terminal(false))).toBe(1);
  expect(await setup([], { HOME, SHELL: '/bin/bash', CI: 'true' }, terminal())).toBe(1);
  expect(await setup(['--no-completion'], { HOME }, terminal(false))).toBe(0);
  expect(await readdir(HOME)).toEqual([]);
});

it('macOS uses the existing login profile without creating a higher-priority file', async () => {
  const HOME = await home();
  const profile = resolve(HOME, '.profile');
  await writeFile(profile, 'export CUSTOM=yes\n');
  expect(await completionInstallPath('bash', { HOME }, 'darwin')).toBe(profile);
  await installCompletion('bash', profile);
  expect(await readFile(profile, 'utf8')).toMatch(/^export CUSTOM=yes\n/u);
  expect(await readdir(HOME)).toEqual(['.profile']);
  expect(spawnSync('sh', ['-n', profile]).status).toBe(0);
  expect(spawnSync('bash', ['-n', profile]).status).toBe(0);
});

it('preserves custom and empty fish files in XDG_CONFIG_HOME', async () => {
  const HOME = await home();
  const XDG_CONFIG_HOME = resolve(HOME, 'config');
  const path = await completionInstallPath('fish', { HOME, XDG_CONFIG_HOME });
  await mkdir(resolve(XDG_CONFIG_HOME, 'fish/completions'), { recursive: true });
  for (const text of ['custom fish completion', '']) {
    await writeFile(path, text);
    expect(await installCompletion('fish', path)).toBe(false);
    expect(await readFile(path, 'utf8')).toBe(text);
  }
});

it('supports shell overrides and ZDOTDIR, preserves manual setup, and rejects unsupported shells', async () => {
  const HOME = await home();
  const ZDOTDIR = resolve(HOME, 'zsh');
  const path = resolve(ZDOTDIR, '.zshrc');
  expect(await setup(['--yes', '--shell', 'zsh'], { HOME, ZDOTDIR, SHELL: '/bin/sh' }, terminal(false))).toBe(0);
  expect(await readFile(path, 'utf8')).toContain('$+functions[compdef]');
  await writeFile(path, 'eval "$(inheriti completion zsh)"\n');
  expect(await installCompletion('zsh', path)).toBe(false);
  expect(await setup(['--yes'], { HOME, SHELL: '/bin/sh' }, terminal(false))).toBe(1);
});
