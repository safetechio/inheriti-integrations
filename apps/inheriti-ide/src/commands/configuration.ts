import * as vscode from 'vscode';
import { BUILD_DEPLOYMENT } from '../configuration.js';
import { parseImportedConfiguration } from '../import-configuration.js';
import { MASTER_KEY_PASSPHRASE_SECRET } from '../master-keys.js';
import type { CommandContext } from './context.js';

export function registerConfigurationCommands(deps: CommandContext): vscode.Disposable[] {
  const { context, changeOrganization, refresh } = deps;
  async function configurationFile(): Promise<vscode.Uri | undefined> {
    const fromEnvironment = process.env.INHERITI_ELEMENTS_CONFIG?.trim();
    if (fromEnvironment) return vscode.Uri.file(fromEnvironment);
    const picked = await vscode.window.showOpenDialog({
      title: 'Import Inheriti configuration',
      canSelectMany: false,
      filters: { JSON: ['json'] },
    });
    return picked?.[0];
  }

  return [
    ...(BUILD_DEPLOYMENT ? [] : [vscode.commands.registerCommand('inheriti.importConfiguration', async () => {
      const file = await configurationFile();
      if (!file) return;
      try {
        const { settings, passphrase } = parseImportedConfiguration(Buffer.from(
          await vscode.workspace.fs.readFile(file),
        ).toString('utf8'));
        const configuration = vscode.workspace.getConfiguration('inheriti');
        for (const [key, value] of Object.entries(settings)) {
          await configuration.update(key, value, vscode.ConfigurationTarget.Global);
        }
        if (!('applicationId' in settings)) await configuration.update('applicationId', '', vscode.ConfigurationTarget.Global);
        // Never a setting: settings are plaintext JSON on disk and sync between machines.
        if (passphrase !== undefined) await context.secrets.store(MASTER_KEY_PASSPHRASE_SECRET, passphrase);
        await vscode.window.showInformationMessage(
          `Configuration imported${passphrase === undefined ? '' : ', passphrase stored'}.`,
        );
      } catch (error) {
        await vscode.window.showErrorMessage(`Could not import that configuration: ${(error as Error).message}`);
        return;
      }
      await changeOrganization();
      await refresh();
    })]),
  ];
}
