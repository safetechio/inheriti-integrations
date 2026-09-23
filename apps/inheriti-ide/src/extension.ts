import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NodeIntegrationCore } from '@safetech/inheriti-elements-core/node';
import type { BusinessOrganization } from '@safetech/inheriti-elements-core/node';
import { PlanTreeProvider } from './plan-tree.js';
import { SecretSessionStore } from './session-store.js';
import { BUILD_DEPLOYMENT, resolveConfiguration } from './configuration.js';
import { createExtensionCore } from './elements.js';
import { signIn } from './login.js';
import { messageFor, rowsFor } from './plan-view-model.js';
import type { PlanRow, PlanViewState } from './plan-view-model.js';
import { codeOf, loadPlans } from './plan-loader.js';
import { planIdFromUriPath, planUriPath, renderPlanDetail } from './plan-detail.js';
import { ActiveRevealRegistry, revealAndInsert } from './reveal.js';
import { downloadAsset } from './download.js';
import { createIdeSafeKeyPro } from './safekey-pro.js';
import { parseImportedConfiguration } from './import-configuration.js';
import { MASTER_KEY_PASSPHRASE_SECRET } from './master-keys.js';
import { discoverOrganizations, saveOrganization } from './organizations.js';
import { latestIntegrationBuild } from '@safetech/inheriti-elements-core/node';

const PLAN_SCHEME = 'inheriti-plan';

/** What `activate` returns to VS Code, and to anything inspecting the extension through its exports. */
export interface InheritiExtensionApi {
  /** The rows the plans view is showing right now — the same ones the tree paints. */
  currentRows(): readonly PlanRow[];
  refresh(): Promise<void>;
}

export function activate(context: vscode.ExtensionContext): InheritiExtensionApi {
  const plans = new PlanTreeProvider(context.globalStorageUri);
  let currentState: PlanViewState = { kind: 'SIGNED_OUT' };
  const render = (state: PlanViewState): void => { currentState = state; plans.render(state); };
  const sessions = new SecretSessionStore(context.secrets);
  const activeReveals = new ActiveRevealRegistry();
  let pendingCallback: ((uri: string) => void) | undefined;
  let selectedOrganization: BusinessOrganization | undefined;
  const cachedCores = new Map<string, NodeIntegrationCore>();
  let revision = 0;
  const detailChanged = new vscode.EventEmitter<vscode.Uri>();

  const configuration = () => resolveConfiguration((key) => vscode.workspace.getConfiguration('inheriti').get<string>(key));
  const withPromptCancellation = async <T>(signal: AbortSignal | undefined, show: (token: vscode.CancellationToken) => Thenable<T>): Promise<T> => {
    const source = new vscode.CancellationTokenSource();
    const abort = () => source.cancel();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) source.cancel();
    try { return await show(source.token); }
    finally { signal?.removeEventListener('abort', abort); source.dispose(); }
  };
  const safeKeyPro = () => createIdeSafeKeyPro(configuration(), {
    readPin: (signal) => withPromptCancellation(signal, (token) => vscode.window.showInputBox({
      title: 'SafeKey PRO PIN', prompt: 'Enter the PIN for your connected SafeKey PRO.', password: true, ignoreFocusOut: true,
    }, token)),
    touch: (operation, attempt, limit) => { vscode.window.setStatusBarMessage(`SafeKey PRO ${operation} ${attempt}/${limit}: press and release the touch button.`, 30_000); },
  });
  const pickCustodianDevice = async (signal?: AbortSignal): Promise<'SK_MOBILE' | 'SK_PRO' | undefined> => {
    const choice = await withPromptCancellation(signal, (token) => vscode.window.showQuickPick([
      { label: 'SafeKey Mobile', value: 'SK_MOBILE' as const },
      { label: 'SafeKey PRO (connected locally)', value: 'SK_PRO' as const },
    ], { title: 'Where should this plan share be stored?', ignoreFocusOut: true }, token));
    return choice?.value;
  };
  const core = (scoped = true): NodeIntegrationCore => {
    const settings = configuration();
    if (scoped && settings.business && !selectedOrganization) {
      throw Object.assign(new Error('organization_selection_required'), { code: 'organization_selection_required' });
    }
    const organizationId = scoped ? selectedOrganization?.id : undefined;
    const key = JSON.stringify([settings, organizationId]);
    const cached = cachedCores.get(key);
    if (cached) return cached;
    const value = createExtensionCore(settings, sessions, context.secrets, organizationId);
    cachedCores.set(key, value);
    return value;
  };

  async function changeOrganization(next?: BusinessOrganization): Promise<number> {
    const changed = ++revision;
    activeReveals.dispose();
    const previous = [...cachedCores.values()];
    cachedCores.clear();
    selectedOrganization = next;
    render({ kind: 'LOADING' });
    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.scheme === PLAN_SCHEME) detailChanged.fire(document.uri);
    }
    await Promise.allSettled(previous.map((client) => client.forgetMasterKey()));
    return changed;
  }

  async function currentCore(): Promise<NodeIntegrationCore> {
    if (!configuration().business) return core();
    const started = revision;
    const choice = await discoverOrganizations(core(false), sessions, context.globalState, configuration());
    if (started !== revision) throw Object.assign(new Error('organization_selection_required'), { code: 'organization_selection_required' });
    if (choice.signedOut) {
      if (selectedOrganization) await changeOrganization();
      render({ kind: 'SIGNED_OUT' });
      throw Object.assign(new Error('operator_not_signed_in'), { code: 'operator_not_signed_in' });
    }
    if (choice.selected?.id !== selectedOrganization?.id) {
      await changeOrganization(choice.selected);
      void refresh();
    }
    if (!choice.selected) {
      render({ kind: 'SELECT_ORGANIZATION', count: choice.items.length });
      throw Object.assign(new Error(choice.items.length ? 'organization_selection_required' : 'organization_required'),
        { code: choice.items.length ? 'organization_selection_required' : 'organization_required' });
    }
    return core();
  }

  async function refresh(): Promise<void> {
    let started = ++revision;
    render({ kind: 'LOADING' });
    try {
      const settings = configuration();
      if (settings.business) {
        const choice = await discoverOrganizations(core(false), sessions, context.globalState, settings);
        if (started !== revision) return;
        if (choice.selected?.id !== selectedOrganization?.id) {
          started = await changeOrganization(choice.selected);
          if (started !== revision) return;
        }
        const current = revision;
        if (choice.signedOut) { render({ kind: 'SIGNED_OUT' }); return; }
        if (!choice.selected) { render({ kind: 'SELECT_ORGANIZATION', count: choice.items.length }); return; }
        const result = await loadPlans(core);
        if (current !== revision) return;
        render(result.kind === 'PLANS' || result.kind === 'EMPTY'
          ? { ...result, organization: choice.selected.name } : result);
        return;
      }
      if (selectedOrganization) {
        started = await changeOrganization();
        if (started !== revision) return;
      }
      const current = revision;
      const result = await loadPlans(core);
      if (current === revision) render(result);
    } catch (error) {
      if (started === revision) render({ kind: 'ERROR', code: codeOf(error) });
    }
  }

  async function notifyUpdate(): Promise<void> {
    if (!BUILD_DEPLOYMENT || !(await sessions.load())) return;
    const version = String(context.extension.packageJSON.version);
    const key = `inheriti.updateChecked.${version}`;
    if (Date.now() - context.globalState.get<number>(key, 0) < 24 * 60 * 60 * 1000) return;
    await context.globalState.update(key, Date.now());
    try {
      const build = latestIntegrationBuild(await core(false).listInternalBuilds(), 'ide', version, 'all');
      if (build) void vscode.window.showInformationMessage(`Inheriti IDE ${build.version} is available.`, 'Install').then((choice) => {
        if (choice === 'Install') void vscode.commands.executeCommand('inheriti.checkUpdate');
      });
    } catch { /* The extension still works if the catalog is unavailable. */ }
  }

  context.subscriptions.push(
    activeReveals,
    detailChanged,
    vscode.window.registerTreeDataProvider('inheriti.plans', plans),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('inheriti')) {
        void sessions.clear().then(() => changeOrganization()).then(refresh);
      }
    }),

    vscode.window.registerUriHandler({
      handleUri: (uri) => {
        pendingCallback?.(uri.toString(true));
      },
    }),

    vscode.workspace.registerTextDocumentContentProvider(PLAN_SCHEME, {
      onDidChange: detailChanged.event,
      provideTextDocumentContent: async (uri) => {
        const started = revision;
        try {
          const plan = await (await currentCore()).getPlan(planIdFromUriPath(uri.path));
          return started === revision ? renderPlanDetail(plan) : '';
        } catch (error) {
          return messageFor(codeOf(error));
        }
      },
    }),

    vscode.commands.registerCommand('inheriti.signIn', async () => {
      const started = revision;
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
        if (started !== revision) {
          await sessions.clear();
          return;
        }
        await vscode.window.showInformationMessage('Signed in to Inheriti.');
        void notifyUpdate();
      } catch (error) {
        await vscode.window.showErrorMessage(messageFor(codeOf(error)));
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
        // The tree empties in the same interaction: a stale plan list after sign-out would be a lie.
        render({ kind: 'SIGNED_OUT' });
      }
      await vscode.window.showInformationMessage('Signed out of Inheriti.');
    }),

    vscode.commands.registerCommand('inheriti.refresh', refresh),
    vscode.commands.registerCommand('inheriti.showVersion', async () => {
      await vscode.window.showInformationMessage(`Inheriti IDE ${context.extension.packageJSON.version}`);
    }),
    vscode.commands.registerCommand('inheriti.checkUpdate', async () => {
      const version = String(context.extension.packageJSON.version);
      if (!BUILD_DEPLOYMENT) { await vscode.window.showInformationMessage(`Inheriti IDE ${version}: updates require a channel-locked build.`); return; }
      try {
        const build = latestIntegrationBuild(await core(false).listInternalBuilds(), 'ide', version, 'all');
        if (!build) { await vscode.window.showInformationMessage(`Inheriti IDE ${version} is up to date.`); return; }
        const choice = await vscode.window.showInformationMessage(`Inheriti IDE ${build.version} is available. Install and reload VS Code to use it.`, 'Install');
        if (choice !== 'Install') return;
        const directory = await mkdtemp(join(tmpdir(), 'inheriti-ide-update-'));
        try {
          const { url } = await core(false).requestInternalBuildDownload(build.id);
          const response = await fetch(url);
          if (!response.ok) throw new Error('Update download failed.');
          const path = join(directory, 'inheriti-ide.vsix');
          if (!response.body) throw new Error('Update download failed.');
          const target = await open(path, 'wx', 0o600);
          const hash = createHash('sha256');
          let size = 0;
          try {
            const reader = response.body.getReader();
            while (true) {
              const { done, value: chunk } = await reader.read();
              if (done) break;
              size += chunk.length;
              if (size > build.size) throw new Error('Update integrity check failed.');
              hash.update(chunk);
              for (let offset = 0; offset < chunk.length;) offset += (await target.write(chunk, offset)).bytesWritten;
            }
          } finally { await target.close(); }
          if (size !== build.size || hash.digest('hex') !== build.checksum) throw new Error('Update integrity check failed.');
          await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(path));
          await vscode.window.showInformationMessage(`Inheriti IDE ${build.version} installed. Reload the window to use it.`, 'Reload').then(async (action) => {
            if (action === 'Reload') await vscode.commands.executeCommand('workbench.action.reloadWindow');
          });
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      } catch {
        await vscode.window.showErrorMessage('Inheriti IDE update failed. Check your connection and retry.');
      }
    }),

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
          codeOf(error), configuration().business ? 'Organisation' : 'Application',
        ));
      }
    }),

    /** Drops the held key so the next reveal acquires it again. */
    vscode.commands.registerCommand('inheriti.forgetMasterKey', async () => {
      await (await currentCore()).forgetMasterKey();
      await vscode.window.showInformationMessage(
        `Forgot the ${configuration().business ? 'organization' : 'Application'} key. The next reveal will acquire it again.`,
      );
    }),

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

    vscode.commands.registerCommand('inheriti.openPlan', async (planId: string) => {
      try { await currentCore(); } catch (error) { await vscode.window.showErrorMessage(messageFor(codeOf(error))); return; }
      const uri = vscode.Uri.parse(`${PLAN_SCHEME}:${planUriPath(planId)}`);
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true });
    }),

    vscode.commands.registerCommand('inheriti.revealPlan', async (input?: string | { planId?: string }) => {
      await runRevealCommand(input);
    }),

    vscode.commands.registerCommand('inheriti.insertField', async (input?: string | { planId?: string }) => {
      await runRevealCommand(input);
    }),

    vscode.commands.registerCommand('inheriti.downloadAsset', async (input?: string | { planId?: string }) => {
      const planId = typeof input === 'string' ? input : input?.planId;
      const selectedPlanId = planId ?? await vscode.window.showInputBox({ title: 'Download an asset', prompt: 'Enter the plan id.', ignoreFocusOut: true });
      if (!selectedPlanId) return;
      try {
        const client = await currentCore();
        const started = revision;
        await downloadAsset(client as never, {
          pickCustodianDevice,
          withProgress: (task) => Promise.resolve(vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Inheriti', cancellable: true }, task)),
          pickAsset: async (items) => {
            if (started !== revision) return undefined;
            const picked = await vscode.window.showQuickPick(items, { title: 'Choose a binary asset', ignoreFocusOut: true });
            return started === revision ? picked?.selector : undefined;
          },
          savePath: async () => {
            if (started !== revision) return undefined;
            const uri = await vscode.window.showSaveDialog({ title: 'Save asset' });
            if (started !== revision) return undefined;
            if (uri && uri.scheme !== 'file') throw Object.assign(new Error('Choose a local file.'), { code: 'download_local_file_required' });
            return uri?.fsPath;
          },
        }, activeReveals, selectedPlanId, configuration().business ? 'Organisation' : 'Application', safeKeyPro());
        await vscode.window.showInformationMessage('Asset saved. Reveal closed.');
      } catch (error) {
        if ((error as { name?: unknown })?.name === 'AbortError' || (error as Error)?.message === 'SAFEKEY_ABORTED') {
          await vscode.window.showInformationMessage('Download canceled.'); return;
        }
        await vscode.window.showErrorMessage(messageFor(
          codeOf(error), configuration().business ? 'Organisation' : 'Application',
        ));
      }
    }),

    vscode.commands.registerCommand('inheriti.abortPlanAccess', async (input?: string | { planId?: string }) => {
      await runAbortCommand(input);
    }),
  );

  /**
   * Gives up the governed access this operator holds on a plan.
   *
   * A governed access outlives the reveal that opened it, and the next reveal takes it up where it
   * stopped. This is the other choice: the access is not wanted, and the next reveal starts clean.
   */
  async function runAbortCommand(input?: string | { planId?: string }): Promise<void> {
    const planId = typeof input === 'string' ? input : input?.planId;
    const selectedPlanId = planId ?? await vscode.window.showInputBox({
      title: 'Abort plan access',
      prompt: 'Enter the plan id whose open access you want to give up.',
      ignoreFocusOut: true,
    });
    if (!selectedPlanId) return;
    try {
      const { aborted } = await (await currentCore()).abortPlanAccess(selectedPlanId);
      await vscode.window.showInformationMessage(aborted
        ? 'Access aborted. The next reveal of this plan will start a new request.'
        : 'No access is open on this plan.');
    } catch (error) {
      await vscode.window.showErrorMessage(messageFor(codeOf(error)));
    }
  }

  /** The harness points `INHERITI_ELEMENTS_CONFIG` at the file it generated; otherwise, ask. */
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

  async function runRevealCommand(input?: string | { planId?: string }): Promise<void> {
    const targetEditor = vscode.window.activeTextEditor;
    const targetSelection = targetEditor?.selection;
    const targetVersion = targetEditor?.document.version;
    const planId = typeof input === 'string' ? input : input?.planId;
    const selectedPlanId = planId ?? await vscode.window.showInputBox({
      title: 'Insert a protected field',
      prompt: 'Enter the plan id whose field you want to insert.',
      ignoreFocusOut: true,
    });
    if (!selectedPlanId) return;
    try {
      const client = await currentCore();
      const started = revision;
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
          if (started !== revision) return undefined;
          const selected = await vscode.window.showQuickPick(items, {
            title: 'Choose the protected field to insert',
            placeHolder: 'Asset and field names only — values remain protected',
            ignoreFocusOut: true,
          });
          return started === revision ? selected?.selector : undefined;
        },
        insertAtCursor: async (value) => {
          if (started !== revision) return false;
          if (!targetEditor || !targetSelection || vscode.window.activeTextEditor !== targetEditor
            || targetEditor.document.isClosed || targetEditor.document.version !== targetVersion
            || !targetEditor.selection.isEqual(targetSelection)) return false;
          return targetEditor.edit((edit) => edit.replace(targetSelection, value), { undoStopBefore: true, undoStopAfter: true });
        },
      }, activeReveals, selectedPlanId, configuration().business ? 'Organisation' : 'Application', safeKeyPro());
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
        codeOf(error), configuration().business ? 'Organisation' : 'Application',
      ));
    }
  }

  void refresh();
  void notifyUpdate();

  return { currentRows: () => rowsFor(currentState), refresh };
}

export function deactivate(): void {}
