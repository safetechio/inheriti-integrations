import * as vscode from 'vscode';
import { signIn } from '../login.js';
import { codeOf } from '../plan-loader.js';
import { messageFor } from '../plan-view-model.js';
import { notifyUpdate } from './updates.js';
import type { CommandContext } from './context.js';

export function registerAuthCommands(deps: CommandContext): vscode.Disposable[] {
  const { sessions, core, changeOrganization, refresh, render, keyOwner, revision } = deps;
  let pendingCallback: ((uri: string | undefined) => void) | undefined;
  let transition: Promise<void> = Promise.resolve();
  const serialize = (operation: () => Promise<void>): Promise<void> => {
    const next = transition.then(operation);
    transition = next.catch(() => undefined);
    return next;
  };
  return [
    vscode.window.registerUriHandler({ handleUri: (uri) => pendingCallback?.(uri.toString(true)) }),
    vscode.commands.registerCommand('inheriti.signIn', () => serialize(async () => {
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
    })),
    vscode.commands.registerCommand('inheriti.signOut', () => {
      pendingCallback?.(undefined);
      return serialize(async () => {
      let revocationFailed = false;
      try {
        await core(false).auth.clear();
      } catch {
        revocationFailed = true;
      } finally {
        await sessions.clear();
        await changeOrganization();
        render({ kind: 'SIGNED_OUT' });
      }
      if (revocationFailed) {
        await vscode.window.showWarningMessage('Signed out locally. Server session revocation could not be confirmed.');
        return;
      }
      await vscode.window.showInformationMessage('Signed out of Inheriti.');
      });
    }),
  ];
}
