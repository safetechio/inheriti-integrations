import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { commandUsage } from '../src/commands/help.js';
import { requireCliUpdate } from '../src/commands/update.js';
import { completionInstallPath } from '../src/completion/install.js';
import { completionScript } from '../src/completion/shell.js';
import { defaultConfigurationPath } from '../src/configuration.js';
import { defaultSessionPath } from '../src/session-store.js';
import type { CliContext } from '../src/session.js';
import type { Terminal } from '../src/output.js';

vi.mock('../src/install-identity.js', () => ({ CLI_COMMAND: 'inheriti-dev' }));

it('uses the installed command for state, help and completion', async () => {
  const home = process.cwd();
  expect(defaultConfigurationPath({ XDG_CONFIG_HOME: home })).toBe(join(home, 'inheriti-dev', 'config.json'));
  expect(defaultSessionPath({ XDG_STATE_HOME: home })).toBe(join(home, 'inheriti-dev', 'session.json'));
  expect(commandUsage(['plans'], {})).toContain('Usage: inheriti-dev plans');
  expect(commandUsage(['automations', 'pair', 'google'], {})).toContain('/usr/local/bin/inheriti.');
  expect(completionScript('bash')).toContain('-F _inheriti_dev_complete inheriti-dev');
  expect(completionScript('zsh')).toContain('compdef _inheriti_dev inheriti-dev');
  expect(completionScript('fish')).toContain('complete -c inheriti-dev');
  expect(await completionInstallPath('fish', { XDG_CONFIG_HOME: home })).toBe(join(home, 'fish', 'completions', 'inheriti-dev.fish'));
});

it('does not install a legacy download over a side-by-side CLI', async () => {
  const requestInternalBuildDownload = vi.fn();
  const context = {
    sessions: { load: async () => ({}) },
    core: {
      listInternalBuilds: async () => [{
        id: 'legacy', integration: 'cli', platform: `${process.platform}-${process.arch}`,
        version: '1.2.4-dev.0', fileName: 'safetech-inheriti-cli-1.2.4-dev.0.tgz',
      }],
      requestInternalBuildDownload,
    },
  } as unknown as CliContext;
  const terminal = { interactive: true, write: vi.fn(), writeError: vi.fn() } as unknown as Terminal;
  expect(await requireCliUpdate(context, terminal, '1.2.3-dev.0')).toBe(1);
  expect(terminal.writeError).toHaveBeenCalledWith(expect.stringContaining('cannot replace inheriti-dev'));
  expect(requestInternalBuildDownload).not.toHaveBeenCalled();
});
