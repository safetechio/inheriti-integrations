import * as vscode from 'vscode';
import { discoverOrganizations, saveOrganization } from '../organizations.js';
import { codeOf } from '../plan-loader.js';
import { messageFor } from '../plan-view-model.js';
import type { CommandContext } from './context.js';

export function registerOrganizationCommands(deps: CommandContext): vscode.Disposable[] {
  const { configuration, core, sessions, context, changeOrganization, render, refresh, keyOwner, currentCore } = deps;
  return [
    vscode.commands.registerCommand('inheriti.selectOrganization', async () => {
      try {
        const settings = configuration();
        if (!settings.business) { await vscode.window.showInformationMessage('Leave the Application id blank to use Business organizations.'); return; }
        const choice = await discoverOrganizations(core(false), sessions, context.globalState, settings);
        if (choice.signedOut) { await vscode.window.showInformationMessage('Sign in before choosing a Business organization.'); return; }
        if (choice.items.length === 0) { await changeOrganization(); render({ kind: 'SELECT_ORGANIZATION', count: 0 }); return; }
        const picked = await vscode.window.showQuickPick(choice.items.map(({ id, name }) => ({ label: name, description: id, id })),
          { title: 'Choose a Business organization', placeHolder: 'Only organizations you can access are listed' });
        if (!picked) return;
        const organization = await saveOrganization(core(false), sessions, context.globalState, settings, picked.id);
        await changeOrganization(organization);
        await refresh();
      } catch (error) {
        await vscode.window.showErrorMessage(messageFor(
          codeOf(error), keyOwner(),
        ));
      }
    }),

    vscode.commands.registerCommand('inheriti.forgetOrgKey', async () => {
      await (await currentCore()).forgetMasterKey();
      await vscode.window.showInformationMessage(
        `Forgot the ${configuration().business ? 'organization' : 'Application'} key. The next reveal will acquire it again.`,
      );
    }),
  ];
}
