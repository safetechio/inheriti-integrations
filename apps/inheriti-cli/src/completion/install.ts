import { appendFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { completionScript, type CompletionShell } from './shell.js';

const MARKER = '# inheriti shell completion';

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function completionInstallPath(
  shell: CompletionShell,
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  const home = env.HOME || homedir();
  if (shell === 'fish') return resolve(env.XDG_CONFIG_HOME || resolve(home, '.config'), 'fish/completions/inheriti.fish');
  if (shell === 'zsh') return resolve(env.ZDOTDIR || home, '.zshrc');
  if (platform === 'darwin') {
    for (const name of ['.bash_profile', '.bash_login', '.profile']) {
      const path = resolve(home, name);
      if (await exists(path)) return path;
    }
    return resolve(home, '.bash_profile');
  }
  return resolve(home, '.bashrc');
}

export async function installCompletion(shell: CompletionShell, path: string): Promise<boolean> {
  if (shell === 'fish') {
    if (await exists(path)) return false;
    await mkdir(dirname(path), { recursive: true });
    try { await writeFile(path, `${MARKER}\n${completionScript(shell)}`, { flag: 'wx' }); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  }
  let current = '';
  try { current = await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (current.includes(MARKER) || /(?:source|eval|\.)[^\n]*inheriti\s+completion\s+(?:bash|zsh)/u.test(current)) return false;
  await mkdir(dirname(path), { recursive: true });
  const script = shell === 'bash'
    ? 'if [ -n "${BASH_VERSION:-}" ] && command -v inheriti >/dev/null 2>&1; then\n  eval "$(inheriti completion bash)"\nfi\n'
    : 'if command -v inheriti >/dev/null 2>&1; then\n  if ! (( $+functions[compdef] )); then autoload -Uz compinit; compinit; fi\n  source <(inheriti completion zsh)\nfi\n';
  await appendFile(path, `${current.length > 0 && !current.endsWith('\n') ? '\n' : ''}${MARKER}\n${script}`);
  return true;
}
