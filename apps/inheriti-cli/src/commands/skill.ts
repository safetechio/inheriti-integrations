import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { defaultConfigurationPath } from '../configuration.js';
import type { Terminal } from '../output.js';
import { promptSelect, promptText } from '../render/select.js';
import { reconcileCliSkill } from '../skill-install.js';

type Choice = { agent: 'codex' | 'claude' } | { agent: 'all' } | { agent: 'custom'; directory: string };
type Preferences = { schema: 1; choice: Choice };
const choices = [
  { value: 'codex', label: 'Codex', description: 'Install in Codex skills' },
  { value: 'claude', label: 'Claude Code', description: 'Install in Claude Code skills' },
  { value: 'all', label: 'Both', description: 'Install in Codex and Claude Code' },
  { value: 'custom', label: 'Other skills folder', description: 'Choose an absolute directory' },
  { value: 'skip', label: 'Skip', description: 'Leave the skill uninstalled' },
] as const;
const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code;
const preferencePath = (env: Readonly<Record<string, string | undefined>>) => join(dirname(defaultConfigurationPath(env)), 'skill-install.json');
const owner = (env: Readonly<Record<string, string | undefined>>) => !(process.getuid?.() === 0 && env.SUDO_USER);
function validChoice(value: unknown): value is Choice {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  const keys = Object.keys(entry);
  if (entry.agent === 'custom') return keys.length === 2 && typeof entry.directory === 'string' && isAbsolute(entry.directory);
  return keys.length === 1 && (entry.agent === 'codex' || entry.agent === 'claude' || entry.agent === 'all');
}
async function safeDirectory(path: string, create: boolean): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch (error) {
    if (code(error) !== 'ENOENT') throw error;
    if (!create) return false;
    await mkdir(path, { recursive: true, mode: 0o700 });
    return await safeDirectory(path, false);
  }
}
export async function readSkillChoice(env: Readonly<Record<string, string | undefined>>): Promise<Choice | undefined> {
  if (!owner(env)) return undefined;
  const path = preferencePath(env);
  if (!(await safeDirectory(dirname(path), false))) return undefined;
  const directoryInfo = await lstat(dirname(path));
  if (process.getuid?.() !== undefined && directoryInfo.uid !== process.getuid?.()) return undefined;
  let info;
  try { info = await lstat(path); } catch (error) { if (code(error) === 'ENOENT') return undefined; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || (process.getuid?.() !== undefined && info.uid !== process.getuid?.())) throw new Error('Unsafe skill preference file.');
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length !== 2 ||
      (parsed as Preferences).schema !== 1 || !validChoice((parsed as Preferences).choice)) throw new Error('Invalid skill preference file.');
  return (parsed as Preferences).choice;
}
async function saveSkillChoice(env: Readonly<Record<string, string | undefined>>, choice: Choice): Promise<void> {
  if (!owner(env)) throw new Error('Unsafe sudo user context.');
  const path = preferencePath(env);
  if (!(await safeDirectory(dirname(path), true))) throw new Error('Unsafe skill preference directory.');
  const directoryInfo = await lstat(dirname(path));
  if (process.getuid?.() !== undefined && directoryInfo.uid !== process.getuid?.()) throw new Error('Unsafe skill preference directory ownership.');
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || (process.getuid?.() !== undefined && info.uid !== process.getuid?.())) throw new Error('Unsafe skill preference file.');
  } catch (error) { if (code(error) !== 'ENOENT') throw error; }
  const temporary = join(dirname(path), `.skill-install-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify({ schema: 1, choice }) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
function parseChoice(args: readonly string[], home: string): Choice | undefined {
  if (args.length === 2 && args[0] === '--target' && ['codex', 'claude', 'all'].includes(args[1] ?? '')) return { agent: args[1] as 'codex' | 'claude' | 'all' };
  if (args.length === 2 && args[0] === '--directory') {
    const raw = args[1]!;
    const directory = raw === '~' ? home : raw.startsWith('~/') || raw.startsWith('~\\') ? resolve(home, raw.slice(2)) : raw;
    if (isAbsolute(directory)) return { agent: 'custom', directory };
  }
  return undefined;
}
export async function installSkill(packageRoot: string, env: Readonly<Record<string, string | undefined>>, terminal: Terminal,
  args: readonly string[], automatic = false): Promise<number> {
  if (automatic && env.CI) return 0;
  if (!owner(env)) { if (!automatic) terminal.writeError('Unsafe sudo user context.'); return automatic ? 0 : 1; }
  const home = env.HOME || homedir();
  let choice: Choice | undefined;
  try { choice = automatic ? await readSkillChoice(env) : undefined; }
  catch (error) { terminal.writeError(`Inheriti CLI skill: ${(error as Error).message}`); return automatic ? 0 : 1; }
  if (!automatic) {
    if (!terminal.interactive && !args.length) choice = undefined;
    if (args.length) choice = parseChoice(args, home);
    else if (terminal.interactive && !env.CI && owner(env)) {
      const selected = await promptSelect('Install the Inheriti CLI skill for', choices);
      if (!selected || selected === 'skip') return 0;
      if (selected === 'custom') {
        const entered = await promptText('Absolute skills directory', 'Enter an absolute folder path · Esc cancels');
        if (entered === undefined) return 0;
        choice = parseChoice(['--directory', entered], home);
      } else choice = { agent: selected as 'codex' | 'claude' | 'all' };
    }
    if (!choice || (args.length && !parseChoice(args, home))) {
      terminal.writeError('Usage: inheriti skill install [--target codex|claude|all | --directory ABSOLUTE_PATH]'); return 1;
    }
  } else if (!choice) {
    if (terminal.interactive && !env.CI && owner(env)) return installSkill(packageRoot, env, terminal, []);
    return 0;
  }
  if (!choice) return 0;
  const selectedChoice = choice;
  const targets = selectedChoice.agent === 'all' ? ['codex', 'claude'] as const : [selectedChoice.agent] as const;
  const customOptions = selectedChoice.agent === 'custom' ? { agent: 'custom' as const, skillsDirectory: selectedChoice.directory } : undefined;
  let failed = false;
  for (const target of targets) {
    try {
      const result = await reconcileCliSkill(packageRoot, env, home, process.getuid?.(), target === 'custom'
        ? customOptions : { agent: target, createHome: true });
      if (result.status === 'skipped' || result.status === 'busy') {
        terminal.writeError(`Inheriti CLI skill ${target}: ${result.reason ?? result.status}.`);
        failed = true;
        continue;
      }
      if (!automatic || result.status !== 'current') terminal.writeError(`Inheriti CLI skill ${result.status} for ${target}${result.target ? ` at ${result.target}` : ''}.${result.backup ? ` Previous copy saved at ${result.backup}.` : ''} Start a new agent session to load it.`);
    } catch (error) {
      terminal.writeError(`Inheriti CLI skill ${target}: ${(error as Error).message}`);
      failed = true;
    }
  }
  if (failed) return 1;
  try { if (!automatic) await saveSkillChoice(env, choice); }
  catch (error) { terminal.writeError(`Inheriti CLI skill: ${(error as Error).message}`); return 1; }
  return 0;
}
