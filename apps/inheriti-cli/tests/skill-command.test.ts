import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { installSkill, readSkillChoice } from '../src/commands/skill.js';
import type { Terminal } from '../src/output.js';

const prompts = vi.hoisted(() => ({ select: vi.fn(), text: vi.fn() }));
vi.mock('../src/render/select.js', () => ({ promptSelect: prompts.select, promptText: prompts.text }));

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
afterEach(() => vi.clearAllMocks());
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'inheriti-skill-command-'));
  roots.push(root);
  const packageRoot = join(root, 'package');
  const source = join(packageRoot, 'skill', 'inheriti-cli');
  await mkdir(source, { recursive: true });
  const content = '# Skill\n';
  await writeFile(join(source, 'SKILL.md'), content);
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  await writeFile(join(packageRoot, 'skill', 'manifest.json'), JSON.stringify({
    schema: 1, cliVersion: '1.0.0', deployment: 'dev',
    sha256: createHash('sha256').update('SKILL.md').update('\0').update(content).update('\0').digest('hex'),
  }));
  const lines: string[] = [];
  const terminal: Terminal = { write: line => lines.push(line), writeError: line => lines.push(line), interactive: false, stdoutIsTTY: false, columns: 80 };
  const env = { HOME: root, XDG_CONFIG_HOME: join(root, 'config') };
  return { root, packageRoot, terminal, env, lines };
}

it('requires an explicit target in a pipe and leaves no preference', async () => {
  const f = await fixture();
  expect(await installSkill(f.packageRoot, f.env, f.terminal, [])).toBe(1);
  expect(await readSkillChoice(f.env)).toBeUndefined();
  expect(await installSkill(f.packageRoot, f.env, f.terminal, [], true)).toBe(0);
  expect(await readSkillChoice(f.env)).toBeUndefined();
});

it.each([undefined, 'skip'])('leaves the previous choice intact when the selector is canceled: %s', async selected => {
  const f = await fixture();
  expect(await installSkill(f.packageRoot, f.env, f.terminal, ['--target', 'claude'])).toBe(0);
  prompts.select.mockResolvedValueOnce(selected);
  expect(await installSkill(f.packageRoot, f.env, { ...f.terminal, interactive: true }, [])).toBe(0);
  expect(prompts.select).toHaveBeenCalledOnce();
  expect(await readSkillChoice(f.env)).toEqual({ agent: 'claude' });
  await expect(readFile(join(f.root, '.codex', 'skills', 'inheriti-cli', 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('installs both agents, saves the choice, and reuses it automatically', async () => {
  const f = await fixture();
  expect(await installSkill(f.packageRoot, f.env, f.terminal, ['--target', 'all'])).toBe(0);
  expect(await readFile(join(f.root, '.codex', 'skills', 'inheriti-cli', 'SKILL.md'), 'utf8')).toBe('# Skill\n');
  expect(await readFile(join(f.root, '.claude', 'skills', 'inheriti-cli', 'SKILL.md'), 'utf8')).toBe('# Skill\n');
  expect(await readSkillChoice(f.env)).toEqual({ agent: 'all' });
  expect(await installSkill(f.packageRoot, f.env, f.terminal, [], true)).toBe(0);
});

it('saves a custom absolute folder only after installation succeeds', async () => {
  const f = await fixture();
  const folder = join(f.root, 'other', 'skills');
  await mkdir(join(f.root, 'other'));
  expect(await installSkill(f.packageRoot, f.env, f.terminal, ['--directory', folder])).toBe(0);
  expect(await readSkillChoice(f.env)).toEqual({ agent: 'custom', directory: folder });
  expect(await readFile(join(folder, 'inheriti-cli', 'SKILL.md'), 'utf8')).toBe('# Skill\n');
});

it('does not overwrite an unsafe preference file', async () => {
  const f = await fixture();
  await mkdir(join(f.root, 'config', 'inheriti'), { recursive: true });
  const outside = join(f.root, 'outside');
  await writeFile(outside, 'keep');
  await symlink(outside, join(f.root, 'config', 'inheriti', 'skill-install.json'));
  expect(await installSkill(f.packageRoot, f.env, f.terminal, ['--target', 'codex'])).toBe(1);
  expect(await readFile(outside, 'utf8')).toBe('keep');
});

it('skips automatic reconciliation in CI even with a saved choice', async () => {
  const f = await fixture();
  expect(await installSkill(f.packageRoot, f.env, f.terminal, ['--target', 'codex'])).toBe(0);
  await rm(join(f.root, '.codex', 'skills', 'inheriti-cli'), { recursive: true });
  expect(await installSkill(f.packageRoot, { ...f.env, CI: 'true' }, f.terminal, [], true)).toBe(0);
  await expect(readFile(join(f.root, '.codex', 'skills', 'inheriti-cli', 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('does not write preferences through a linked configuration directory', async () => {
  const f = await fixture();
  const other = join(f.root, 'other');
  await mkdir(other);
  await mkdir(join(f.root, 'config'));
  await symlink(other, join(f.root, 'config', 'inheriti'));
  expect(await installSkill(f.packageRoot, f.env, f.terminal, ['--target', 'codex'])).toBe(1);
  await expect(readFile(join(other, 'skill-install.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});
