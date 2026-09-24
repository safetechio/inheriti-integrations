import * as vscode from 'vscode';
import { downloadAsset } from '../download.js';
import { planUriPath } from '../plan-detail.js';
import { codeOf, loadPlans } from '../plan-loader.js';
import { messageFor } from '../plan-view-model.js';
import { revealAndInsert } from '../reveal.js';
import type { CommandContext } from './context.js';

export const PLAN_SCHEME = 'inheriti-plan';

export function registerPlanCommands(deps: CommandContext): vscode.Disposable[] {
  const { currentCore, keyOwner, revision, pickCustodianDevice, activeReveals, safeKeyPro, refresh } = deps;

  async function selectPlanId(input: string | { planId?: string } | undefined, title: string): Promise<string | undefined> {
    const supplied = typeof input === 'string' ? input : input?.planId;
    if (supplied) return supplied;
    const client = await currentCore();
    const started = revision();
    const state = await loadPlans(() => client);
    if (state.kind !== 'PLANS') {
      await vscode.window.showInformationMessage(state.kind === 'EMPTY' ? 'No plans are available.'
        : state.kind === 'SIGNED_OUT' ? 'Sign in to view plans.'
          : state.kind === 'SELECT_ORGANIZATION' ? 'Choose a Business organization to view plans.'
            : messageFor(state.kind === 'ERROR' ? state.code : 'plan_request_failed', keyOwner()));
      return undefined;
    }
    if (started !== revision()) return undefined;
    const picked = await vscode.window.showQuickPick(state.plans.map((plan) => ({
      label: plan.name,
      description: typeof plan.status === 'string' ? plan.status : plan.status.raw,
      detail: plan.description ?? plan.id,
      planId: plan.id,
    })), { title, placeHolder: 'Search plans by name', matchOnDescription: true, matchOnDetail: true, ignoreFocusOut: true });
    return started === revision() ? picked?.planId : undefined;
  }
  /**
   * Gives up the governed access this operator holds on a plan.
   *
   * A governed access outlives the reveal that opened it, and the next reveal takes it up where it
   * stopped. This is the other choice: the access is not wanted, and the next reveal starts clean.
   */
  async function runAbortCommand(input?: string | { planId?: string }): Promise<void> {
    try {
      const selectedPlanId = await selectPlanId(input, 'Choose a plan whose access to abort');
      if (!selectedPlanId) return;
      const { aborted } = await (await currentCore()).abortPlanAccess(selectedPlanId);
      await vscode.window.showInformationMessage(aborted
        ? 'Access aborted. The next reveal of this plan will start a new request.'
        : 'No access is open on this plan.');
    } catch (error) {
      await vscode.window.showErrorMessage(messageFor(codeOf(error), keyOwner()));
    }
  }

  async function runRevealCommand(input?: string | { planId?: string }): Promise<void> {
    const targetEditor = vscode.window.activeTextEditor;
    const targetSelection = targetEditor?.selection;
    const targetVersion = targetEditor?.document.version;
    try {
      const selectedPlanId = await selectPlanId(input, 'Choose a plan to reveal');
      if (!selectedPlanId) return;
      const client = await currentCore();
      const started = revision();
      await revealAndInsert(client as never, {
        pickCustodianDevice,
        withProgress: (task) => Promise.resolve(vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Inheriti',
            cancellable: true,
          },
          task,
        )),
        pickField: async (items) => {
          if (started !== revision()) return undefined;
          const selected = await vscode.window.showQuickPick(items, {
            title: 'Choose the protected field to insert',
            placeHolder: 'Asset and field names only — values remain protected',
            ignoreFocusOut: true,
          });
          return started === revision() ? selected?.selector : undefined;
        },
        insertAtCursor: async (value) => {
          if (started !== revision()) return false;
          if (!targetEditor || !targetSelection || vscode.window.activeTextEditor !== targetEditor
            || targetEditor.document.isClosed || targetEditor.document.version !== targetVersion
            || !targetEditor.selection.isEqual(targetSelection)) return false;
          return targetEditor.edit((edit) => edit.replace(targetSelection, value), { undoStopBefore: true, undoStopAfter: true });
        },
      }, activeReveals, selectedPlanId, keyOwner(), safeKeyPro());
      await vscode.window.showInformationMessage('Protected field inserted. Reveal closed.');
    } catch (error) {
      if (codeOf(error) === 'governance_denied') {
        await vscode.window.showErrorMessage((error as Error).message);
        return;
      }
      if ((error as { name?: unknown })?.name === 'AbortError' || (error as Error)?.message === 'SAFEKEY_ABORTED') {
        await vscode.window.showInformationMessage('Reveal canceled.');
        return;
      }
      await vscode.window.showErrorMessage(messageFor(
        codeOf(error), keyOwner(),
      ));
    }
  }

  return [
    vscode.commands.registerCommand('inheriti.showPlans', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.inheriti');
      await refresh();
    }),

    vscode.commands.registerCommand('inheriti.openPlan', async (input?: string | { planId?: string }) => {
      try {
        const planId = await selectPlanId(input, 'Choose a plan to open');
        if (!planId) return;
        await currentCore();
        const uri = vscode.Uri.parse(`${PLAN_SCHEME}:${planUriPath(planId)}`);
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true });
      } catch (error) { await vscode.window.showErrorMessage(messageFor(codeOf(error), keyOwner())); }
    }),

    vscode.commands.registerCommand('inheriti.revealPlan', async (input?: string | { planId?: string }) => {
      await runRevealCommand(input);
    }),

    vscode.commands.registerCommand('inheriti.insertField', async (input?: string | { planId?: string }) => {
      await runRevealCommand(input);
    }),

    vscode.commands.registerCommand('inheriti.downloadAsset', async (input?: string | { planId?: string }) => {
      try {
        const selectedPlanId = await selectPlanId(input, 'Choose a plan with a media asset');
        if (!selectedPlanId) return;
        const client = await currentCore();
        const started = revision();
        await downloadAsset(client as never, {
          pickCustodianDevice,
          withProgress: (task) => Promise.resolve(vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Inheriti', cancellable: true }, task)),
          pickAsset: async (items) => {
            if (started !== revision()) return undefined;
            const picked = await vscode.window.showQuickPick(items, { title: 'Choose a media asset', ignoreFocusOut: true });
            return started === revision() ? picked?.selector : undefined;
          },
          savePath: async () => {
            if (started !== revision()) return undefined;
            const uri = await vscode.window.showSaveDialog({ title: 'Save asset' });
            if (started !== revision()) return undefined;
            if (uri && uri.scheme !== 'file') throw Object.assign(new Error('Choose a local file.'), { code: 'download_local_file_required' });
            return uri?.fsPath;
          },
        }, activeReveals, selectedPlanId, keyOwner(), safeKeyPro());
        await vscode.window.showInformationMessage('Asset saved. Reveal closed.');
      } catch (error) {
        if ((error as { name?: unknown })?.name === 'AbortError' || (error as Error)?.message === 'SAFEKEY_ABORTED') {
          await vscode.window.showInformationMessage('Download canceled.'); return;
        }
        await vscode.window.showErrorMessage(messageFor(
          codeOf(error), keyOwner(),
        ));
      }
    }),

    vscode.commands.registerCommand('inheriti.abortPlanAccess', async (input?: string | { planId?: string }) => {
      await runAbortCommand(input);
    }),
  ];
}
