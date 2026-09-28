import { basename } from 'node:path';
import { completionInstallPath, installCompletion } from '../completion/install.js';
import { COMPLETION_SHELLS, type CompletionShell } from '../completion/shell.js';
import type { Terminal } from '../output.js';
import { promptSelect } from '../render/select.jsx';

export async function setup(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  terminal: Terminal,
  select: typeof promptSelect = promptSelect,
): Promise<number> {
  try {
    let yes = false;
    let skip = false;
    let shellName = basename(env.SHELL || '');
    for (let index = 0; index < argv.length; index += 1) {
      const option = argv[index];
      switch (option) {
        case '--yes': yes = true; break;
        case '--no-completion': skip = true; break;
        case '--shell': shellName = argv[++index] || ''; break;
        default: throw new Error(`Unknown setup option: ${option}`);
      }
    }
    if (skip) { terminal.write('Shell autocomplete skipped.'); return 0; }
    if (!(COMPLETION_SHELLS as readonly string[]).includes(shellName)) {
      throw new Error('Choose a supported shell with inheriti setup --shell bash|zsh|fish.');
    }
    if (!yes && (!terminal.interactive || Boolean(env.CI))) {
      throw new Error('Setup requires an interactive terminal. Use --yes to enable autocomplete or --no-completion to skip.');
    }
    const shell = shellName as CompletionShell;
    const path = await completionInstallPath(shell, env);
    terminal.write(`Shell autocomplete file: ${path}`);
    if (!yes && await select('Enable shell autocomplete?', [
      { value: 'yes', description: 'Enable autocomplete (default)' },
      { value: 'no', description: 'Skip autocomplete' },
    ]) !== 'yes') { terminal.write('Shell autocomplete skipped.'); return 0; }
    const installed = await installCompletion(shell, path);
    terminal.write(installed ? 'Shell autocomplete enabled. Open a new shell to use it.' : 'Existing shell autocomplete configuration preserved.');
    return 0;
  } catch (error) {
    terminal.writeError(`Setup failed: ${error instanceof Error ? error.message : 'Unable to enable shell autocomplete.'}`);
    return 1;
  }
}
