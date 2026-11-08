import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { reconcileCliSkill } from '../src/skill-install.js';

const temporary: string[] = [];
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'inheriti-skill-test-'));
  temporary.push(root);
  const packageRoot = join(root, 'package');
  const codexHome = join(root, 'codex');
  const source = join(packageRoot, 'skill', 'inheriti-cli');
  await mkdir(source, { recursive: true });
  await mkdir(codexHome);
  const content = '---\nname: inheriti-cli\ndescription: Use Inheriti plans.\nmetadata:\n  version: 0.0.20-dev.0\n---\n\n# CLI\n';
  await writeFile(join(source, 'SKILL.md'), content);
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ version: '0.0.20-dev.0' }));
  const digest = createHash('sha256').update('SKILL.md').update('\0').update(content).update('\0').digest('hex');
  await writeFile(join(packageRoot, 'skill', 'manifest.json'), JSON.stringify({
    schema: 1, cliVersion: '0.0.20-dev.0', deployment: 'dev', sha256: digest,
  }));
  return { root, packageRoot, codexHome, content, target: join(codexHome, 'skills', 'inheriti-cli') };
}

describe('bundled CLI skill reconciliation', () => {
  it('rejects a custom folder whose staging parent belongs to another user', async () => {
    const { root, packageRoot } = await fixture();
    const uid = (await stat(root)).uid;
    if ((await stat(tmpdir())).uid === uid) return;
    expect(await reconcileCliSkill(packageRoot, {}, root, uid, { agent: 'custom', skillsDirectory: root }))
      .toMatchObject({ status: 'skipped', reason: 'Unsafe Custom home ownership' });
    await expect(stat(join(root, 'inheriti-cli'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uses the default and configured homes for Codex and Claude', async () => {
    const { root, packageRoot } = await fixture();
    for (const agent of ['codex', 'claude'] as const) {
      const home = join(root, `.${agent}`);
      await mkdir(home);
      const result = await reconcileCliSkill(packageRoot, {}, root, process.getuid?.(), { agent });
      expect(result).toMatchObject({ status: 'installed', target: join(home, 'skills', 'inheriti-cli') });
    }
    const configured = join(root, 'configured-claude');
    await mkdir(configured);
    expect(await reconcileCliSkill(packageRoot, { CLAUDE_CONFIG_DIR: configured }, root, process.getuid?.(), { agent: 'claude' }))
      .toMatchObject({ status: 'installed', target: join(configured, 'skills', 'inheriti-cli') });
  });

  it('installs into an explicit custom skills directory and backs up edits outside it', async () => {
    const { root, packageRoot } = await fixture();
    const skillsDirectory = join(root, 'other', 'agent-skills');
    await mkdir(join(root, 'other'));
    const options = { agent: 'custom' as const, skillsDirectory };
    const first = await reconcileCliSkill(packageRoot, {}, root, process.getuid?.(), options);
    expect(first).toMatchObject({ status: 'installed', target: join(skillsDirectory, 'inheriti-cli') });
    await writeFile(join(first.target!, 'SKILL.md'), 'local edit');
    const second = await reconcileCliSkill(packageRoot, {}, root, process.getuid?.(), options);
    expect(second.status).toBe('updated');
    expect(relative(skillsDirectory, second.backup!).startsWith('..')).toBe(true);
    expect(await readFile(join(second.backup!, 'SKILL.md'), 'utf8')).toBe('local edit');
  });

  it('creates a known agent home only when explicitly requested and its parent is safe', async () => {
    const { root, packageRoot } = await fixture();
    const home = join(root, '.claude');
    expect(await reconcileCliSkill(packageRoot, {}, root, process.getuid?.(), { agent: 'claude' }))
      .toMatchObject({ status: 'skipped', reason: 'Claude is not installed' });
    expect(await reconcileCliSkill(packageRoot, {}, root, process.getuid?.(), { agent: 'claude', createHome: true }))
      .toMatchObject({ status: 'installed', target: join(home, 'skills', 'inheriti-cli') });
    expect((await stat(home)).isDirectory()).toBe(true);
  });

  it('rejects unsafe Claude and custom destinations without writing through them', async () => {
    const { root, packageRoot } = await fixture();
    const outside = join(root, 'outside');
    await mkdir(outside);
    expect(await reconcileCliSkill(packageRoot, { CLAUDE_CONFIG_DIR: 'relative' }, root, process.getuid?.(), { agent: 'claude' }))
      .toMatchObject({ status: 'skipped', reason: 'Claude home is not absolute' });
    expect(await reconcileCliSkill(packageRoot, {}, root, process.getuid?.(), { agent: 'custom', skillsDirectory: 'relative' }))
      .toMatchObject({ status: 'skipped', reason: 'Custom skill directory is not absolute' });
    expect(await reconcileCliSkill(packageRoot, {}, root, process.getuid?.(), { agent: 'custom', skillsDirectory: join(root, 'missing', 'skills') }))
      .toMatchObject({ status: 'skipped', reason: 'Custom is not installed' });
    expect(await reconcileCliSkill(packageRoot, { CLAUDE_CONFIG_DIR: join(root, 'missing', '.claude') }, root, process.getuid?.(), { agent: 'claude', createHome: true }))
      .toMatchObject({ status: 'skipped', reason: 'Unsafe Claude home parent' });
    try { await symlink(outside, join(root, '.claude'), 'dir'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') return; throw error; }
    expect(await reconcileCliSkill(packageRoot, {}, root, process.getuid?.(), { agent: 'claude', createHome: true }))
      .toMatchObject({ status: 'skipped', reason: 'Unsafe Claude home' });
    const skillsDirectory = join(root, 'outside', 'skills');
    await symlink(root, skillsDirectory, 'dir');
    expect(await reconcileCliSkill(packageRoot, {}, root, process.getuid?.(), { agent: 'custom', skillsDirectory }))
      .toMatchObject({ status: 'skipped', reason: 'Unsafe skill directory' });
    const owner = (await stat(outside)).uid;
    expect(await reconcileCliSkill(packageRoot, {}, root, owner + 1, { agent: 'custom', skillsDirectory }))
      .toMatchObject({ status: 'skipped', reason: 'Unsafe Custom home ownership' });
    expect(await reconcileCliSkill(packageRoot, { SUDO_USER: 'operator' }, root, 0, { agent: 'custom', skillsDirectory }))
      .toMatchObject({ status: 'skipped', reason: 'Unsafe sudo user context' });
    expect(await readdir(outside)).toEqual(['skills']);
  });

  it('keeps Claude reconciliation locked during concurrent installs', async () => {
    const { root, packageRoot } = await fixture();
    const home = join(root, '.claude');
    await mkdir(home);
    const results = await Promise.all([
      reconcileCliSkill(packageRoot, {}, root, process.getuid?.(), { agent: 'claude' }),
      reconcileCliSkill(packageRoot, {}, root, process.getuid?.(), { agent: 'claude' }),
    ]);
    expect(results.filter(result => result.status === 'installed')).toHaveLength(1);
    expect(results.every(result => ['installed', 'busy', 'current'].includes(result.status))).toBe(true);
  });
  it('installs, stays quiet when current, and reinstalls a deleted skill', async () => {
    const { packageRoot, codexHome, content, target } = await fixture();
    const env = { CODEX_HOME: codexHome };
    expect((await reconcileCliSkill(packageRoot, env)).status).toBe('installed');
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe(content);
    expect((await reconcileCliSkill(packageRoot, env)).status).toBe('current');
    await rm(target, { recursive: true });
    expect((await reconcileCliSkill(packageRoot, env)).status).toBe('installed');
  });

  it('backs up a modified copy outside the discovery root and installs the packaged version', async () => {
    const { packageRoot, codexHome, content, target } = await fixture();
    const env = { CODEX_HOME: codexHome };
    await reconcileCliSkill(packageRoot, env);
    await writeFile(join(target, 'SKILL.md'), 'local edit');
    const result = await reconcileCliSkill(packageRoot, env);
    expect(result.status).toBe('updated');
    expect(result.backup?.startsWith(join(codexHome, 'skills'))).toBe(false);
    expect(await readFile(join(result.backup!, 'SKILL.md'), 'utf8')).toBe('local edit');
    if (process.platform !== 'win32') expect((await stat(result.backup!)).mode & 0o077).toBe(0);
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe(content);
    expect(await readdir(join(codexHome, 'skills'))).toEqual(['inheriti-cli']);
  });

  it('repairs a partial skill while retaining its prior files', async () => {
    const { packageRoot, codexHome, target } = await fixture();
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'note.txt'), 'unfinished copy');
    const result = await reconcileCliSkill(packageRoot, { CODEX_HOME: codexHome });
    expect(result.status).toBe('updated');
    expect(await readFile(join(result.backup!, 'note.txt'), 'utf8')).toBe('unfinished copy');
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toContain('name: inheriti-cli');
  });

  it('does not create an absent agent home and installs after it appears', async () => {
    const { packageRoot, codexHome, target } = await fixture();
    await rm(codexHome, { recursive: true });
    expect((await reconcileCliSkill(packageRoot, { CODEX_HOME: codexHome })).status).toBe('skipped');
    await mkdir(codexHome);
    expect((await reconcileCliSkill(packageRoot, { CODEX_HOME: codexHome })).status).toBe('installed');
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toContain('name: inheriti-cli');
  });

  it('does not write a different user\'s Codex home or through sudo', async () => {
    const { packageRoot, codexHome, target } = await fixture();
    const owner = (await stat(codexHome)).uid;
    expect(await reconcileCliSkill(packageRoot, { CODEX_HOME: codexHome }, undefined, owner + 1))
      .toMatchObject({ status: 'skipped', reason: 'Unsafe Codex home ownership' });
    expect(await reconcileCliSkill(packageRoot, { CODEX_HOME: codexHome, SUDO_USER: 'operator' }, undefined, 0))
      .toMatchObject({ status: 'skipped', reason: 'Unsafe sudo user context' });
    await expect(readFile(join(target, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves a symlink target untouched and rejects a changed package', async () => {
    const { packageRoot, codexHome, target } = await fixture();
    await mkdir(join(codexHome, 'skills'));
    try { await symlink(packageRoot, target, 'dir'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') return; throw error; }
    expect(await reconcileCliSkill(packageRoot, { CODEX_HOME: codexHome }))
      .toMatchObject({ status: 'skipped', reason: 'Unsafe skill target symbolic link' });
    await writeFile(join(packageRoot, 'skill', 'inheriti-cli', 'SKILL.md'), 'tampered');
    await expect(reconcileCliSkill(packageRoot, { CODEX_HOME: codexHome })).rejects.toThrow('checksum');
  });

  it('does not race a concurrent reconciliation lock', async () => {
    const { packageRoot, codexHome, target } = await fixture();
    await mkdir(join(codexHome, '.inheriti-cli-skill.lock'));
    expect((await reconcileCliSkill(packageRoot, { CODEX_HOME: codexHome })).status).toBe('busy');
    await expect(readFile(join(target, 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('lets only one process reclaim an abandoned lock', async () => {
    const { packageRoot, codexHome, target } = await fixture();
    const lock = join(codexHome, '.inheriti-cli-skill.lock');
    await mkdir(lock);
    const old = new Date(Date.now() - 10 * 60_000);
    await utimes(lock, old, old);
    const results = await Promise.all([
      reconcileCliSkill(packageRoot, { CODEX_HOME: codexHome }),
      reconcileCliSkill(packageRoot, { CODEX_HOME: codexHome }),
    ]);
    expect(results.filter(result => result.status === 'installed')).toHaveLength(1);
    expect(results.every(result => ['installed', 'busy', 'current'].includes(result.status))).toBe(true);
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toContain('name: inheriti-cli');
    await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recovers a stale recovery claim without leaving another skill copy', async () => {
    const { packageRoot, codexHome, target } = await fixture();
    const recovery = join(codexHome, '.inheriti-cli-skill-recovery.lock');
    const lock = join(codexHome, '.inheriti-cli-skill.lock');
    await mkdir(recovery);
    await mkdir(lock);
    const old = new Date(Date.now() - 10 * 60_000);
    await utimes(recovery, old, old);
    await utimes(lock, old, old);
    const results = await Promise.all([
      reconcileCliSkill(packageRoot, { CODEX_HOME: codexHome }),
      reconcileCliSkill(packageRoot, { CODEX_HOME: codexHome }),
    ]);
    expect(results.filter(result => result.status === 'installed')).toHaveLength(1);
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toContain('name: inheriti-cli');
    expect(await readdir(join(codexHome, 'skills'))).toEqual(['inheriti-cli']);
    await expect(stat(recovery)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
