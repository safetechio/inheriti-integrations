import * as vscode from 'vscode';
import { signIn } from '../login.js';
import { codeOf } from '../plan-loader.js';
import { messageFor } from '../plan-view-model.js';
import { notifyUpdate } from './updates.js';
import type { CommandContext } from './context.js';

export function registerAuthCommands(deps: CommandContext): vscode.Disposable[] {
  const { sessions, core, changeOrganization, refresh, render, keyOwner, revision } = deps;
  let pendingCallback: ((uri: string) => void) | undefined;
  return [
    vscode.window.registerUriHandler({ handleUri: (uri) => pendingCallback?.(uri.toString(true)) }),
    vscode.commands.registerCommand('inheriti.signIn', async () => {
      const started = revision();
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Signing in to Inheriti', cancellable: true },
          async (_progress, token) => signIn(core(false).auth, {
            openExternal: (url) => Promise.resolve(vscode.env.openExternal(vscode.Uri.parse(url))).then(Boolean),
            awaitCallback: ({ timeoutMs }) => new Promise<string | undefined>((resolve) => {
              const timer = setTimeout(() => { pendingCallback = undefined; resolve(undefined); }, timeoutMs);
              token.onCancellationRequested(() => { clearTimeout(timer); pendingCallback = undefined; resolve(undefined); });
              pendingCallback = (uri) => { clearTimeout(timer); pendingCallback = undefined; resolve(uri); };
            }),
          }),
        );
        if (started !== revision()) {
          await sessions.clear();
          return;
        }
        await vscode.window.showInformationMessage('Signed in to Inheriti.');
        void notifyUpdate(deps);
      } catch (error) {
        await vscode.window.showErrorMessage(messageFor(codeOf(error), keyOwner()));
      }
      await changeOrganization();
      await refresh();
    }),
    vscode.commands.registerCommand('inheriti.signOut', async () => {
      try {
        await core(false).auth.clear();
      } finally {
        await sessions.clear();
        await changeOrganization();
        render({ kind: 'SIGNED_OUT' });
      }
      await vscode.window.showInformationMessage('Signed out of Inheriti.');
    }),
  ];
}
