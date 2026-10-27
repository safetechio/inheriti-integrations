import { createHash, randomUUID } from 'node:crypto';
import { chmod, cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';

interface SkillManifest { schema: 1; cliVersion: string; deployment: string; sha256: string }
export interface SkillInstallResult { status: 'current' | 'installed' | 'updated' | 'skipped' | 'busy'; backup?: string; reason?: string }

function code(error: unknown): string | undefined { return (error as NodeJS.ErrnoException)?.code; }

async function pathStat(path: string) {
  try { return await lstat(path); }
  catch (error) { if (code(error) === 'ENOENT') return undefined; throw error; }
}

async function digestTree(root: string): Promise<string> {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Unsafe skill directory.');
  const hash = createHash('sha256');
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory)).sort()) {
      const path = join(directory, entry);
      const info = await lstat(path);
      if (info.isSymbolicLink() || !(info.isDirectory() || info.isFile())) throw new Error('Unsafe skill file type.');
      if (info.isDirectory()) { await visit(path); continue; }
      hash.update(relative(root, path).split(sep).join('/')).update('\0');
      hash.update(await readFile(path)).update('\0');
    }
  }
  await visit(root);
  return hash.digest('hex');
}

async function restrictTree(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !(info.isDirectory() || info.isFile())) throw new Error('Unsafe skill file type.');
  await chmod(path, info.isDirectory() ? 0o700 : info.mode & 0o100 ? 0o700 : 0o600);
  if (info.isDirectory()) for (const entry of await readdir(path)) await restrictTree(join(path, entry));
}

/** Install only into a known user Codex home. Source and destination are checked before either is renamed. */
export async function reconcileCliSkill(
  packageRoot: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  userHome = homedir(),
  effectiveUid = process.getuid?.(),
): Promise<SkillInstallResult> {
  const manifestPath = join(packageRoot, 'skill', 'manifest.json');
  const manifestInfo = await pathStat(manifestPath);
  if (!manifestInfo) return { status: 'skipped', reason: 'No packaged skill' };
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) throw new Error('Unsafe bundled skill manifest.');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as SkillManifest;
  if (manifest.schema !== 1 || !manifest.cliVersion || !manifest.deployment || !/^[a-f0-9]{64}$/u.test(manifest.sha256))
    throw new Error('Invalid bundled skill manifest.');
  const packageVersion = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as { version?: string };
  if (manifest.cliVersion !== packageVersion.version) throw new Error('Bundled skill version differs from the CLI.');
  const source = join(packageRoot, 'skill', 'inheriti-cli');
  if ((await digestTree(source)) !== manifest.sha256) throw new Error('Bundled skill checksum mismatch.');

  const home = env.CODEX_HOME || join(userHome, '.codex');
  if (!isAbsolute(home)) return { status: 'skipped', reason: 'Codex home is not absolute' };
  const homeInfo = await pathStat(home);
  if (!homeInfo) return { status: 'skipped', reason: 'Codex is not installed' };
  if (!homeInfo.isDirectory() || homeInfo.isSymbolicLink()) return { status: 'skipped', reason: 'Unsafe Codex home' };
  if (effectiveUid === 0 && env.SUDO_USER) return { status: 'skipped', reason: 'Unsafe sudo user context' };
  if (effectiveUid !== undefined && homeInfo.uid !== effectiveUid)
    return { status: 'skipped', reason: 'Unsafe Codex home ownership' };
  const skills = join(home, 'skills');
  const skillsInfo = await pathStat(skills);
  if (skillsInfo && (!skillsInfo.isDirectory() || skillsInfo.isSymbolicLink())) return { status: 'skipped', reason: 'Unsafe skill directory' };
  if (!skillsInfo) await mkdir(skills, { recursive: true, mode: 0o700 });
  const readySkills = await lstat(skills);
  if (!readySkills.isDirectory() || readySkills.isSymbolicLink()) return { status: 'skipped', reason: 'Unsafe skill directory' };
  const target = join(skills, 'inheriti-cli');
  const lock = join(home, '.inheriti-cli-skill.lock');
  const recovery = join(home, '.inheriti-cli-skill-recovery.lock');
  const ownerFile = join(lock, 'owner');
  const recoveryOwnerFile = join(recovery, 'owner');
  const owner = randomUUID();
  const recoveryOwner = randomUUID();
  let lockOwned = false;
  let recoveryOwned = false;
  const claim = async () => {
    await mkdir(lock, { mode: 0o700 });
    await writeFile(ownerFile, owner, { flag: 'wx', mode: 0o600 });
    lockOwned = true;
  };
  const release = async () => {
    if (!lockOwned) return;
    try { if (await readFile(ownerFile, 'utf8') === owner) await rm(lock, { recursive: true, force: true }); }
    catch (error) { if (code(error) !== 'ENOENT') throw error; }
    lockOwned = false;
  };
  const ownsLock = async () => {
    try { return lockOwned && await readFile(ownerFile, 'utf8') === owner; }
    catch (error) { if (code(error) === 'ENOENT') return false; throw error; }
  };
  const recoveryInfo = await pathStat(recovery);
  if (recoveryInfo) {
    if (Date.now() - recoveryInfo.mtimeMs < 5 * 60_000) return { status: 'busy' };
    const orphan = join(home, `.inheriti-cli-skill-recovery-orphan-${randomUUID()}`);
    try { await rename(recovery, orphan); }
    catch (error) { if (code(error) === 'ENOENT') return { status: 'busy' }; throw error; }
    const moved = await lstat(orphan);
    if (moved.ino !== recoveryInfo.ino || moved.dev !== recoveryInfo.dev) {
      try { await rename(orphan, recovery); } catch { /* Keep the live claimant's directory intact. */ }
      return { status: 'busy' };
    }
    await rm(orphan, { recursive: true, force: true });
  }
  try { await claim(); }
  catch (error) {
    if (code(error) !== 'EEXIST') throw error;
    const current = await pathStat(lock);
    if (current && Date.now() - current.mtimeMs < 5 * 60_000) return { status: 'busy' };
    try {
      await mkdir(recovery, { mode: 0o700 });
      await writeFile(recoveryOwnerFile, recoveryOwner, { flag: 'wx', mode: 0o600 });
      recoveryOwned = true;
    }
    catch (recoveryError) { if (code(recoveryError) === 'EEXIST') return { status: 'busy' }; throw recoveryError; }
    try {
      if (await readFile(recoveryOwnerFile, 'utf8') !== recoveryOwner) return { status: 'busy' };
      const stillStale = await pathStat(lock);
      if (stillStale && Date.now() - stillStale.mtimeMs < 5 * 60_000) return { status: 'busy' };
      if (stillStale) await rm(lock, { recursive: true, force: true });
      try { await claim(); }
      catch (retryError) { if (code(retryError) === 'EEXIST') return { status: 'busy' }; throw retryError; }
    } finally {
      if (recoveryOwned) {
        try { if (await readFile(recoveryOwnerFile, 'utf8') === recoveryOwner) await rm(recovery, { recursive: true, force: true }); }
        catch (error) { if (code(error) !== 'ENOENT') throw error; }
      }
    }
  }
  if (await pathStat(recovery) || !(await ownsLock())) { await release(); return { status: 'busy' }; }
  let stage: string | undefined;
  let backup: string | undefined;
  try {
    const existing = await pathStat(target);
    if (!(await ownsLock())) return { status: 'busy' };
    if (existing?.isSymbolicLink()) return { status: 'skipped', reason: 'Unsafe skill target symbolic link' };
    if (existing?.isDirectory()) {
      let installedHash: string;
      try { installedHash = await digestTree(target); }
      catch { return { status: 'skipped', reason: 'Unsafe installed skill contents' }; }
      if (installedHash === manifest.sha256) return { status: 'current' };
    }
    stage = join(home, `.inheriti-cli-skill-stage-${randomUUID()}`);
    await cp(source, stage, { recursive: true, errorOnExist: true, force: false });
    await restrictTree(stage);
    if ((await digestTree(stage)) !== manifest.sha256) throw new Error('Staged skill checksum mismatch.');
    if (existing) {
      if (!(await ownsLock())) return { status: 'busy' };
      backup = join(home, `inheriti-cli-skill-backup-${Date.now()}-${randomUUID()}`);
      await rename(target, backup);
      try { await restrictTree(backup); }
      catch (error) { await rename(backup, target); backup = undefined; throw error; }
    }
    try {
      if (!(await ownsLock())) throw new Error('Skill installation lock was lost.');
      await rename(stage, target); stage = undefined;
    }
    catch (error) { if (backup) { await rename(backup, target); backup = undefined; } throw error; }
    return { status: existing ? 'updated' : 'installed', ...(backup ? { backup } : {}) };
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    await release();
  }
}
