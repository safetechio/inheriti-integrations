import * as vscode from 'vscode';
import type { BusinessOrganization, NodeIntegrationCore } from '@safetech/inheriti-elements-core/node';
import { custodianShareCopy } from '@safetech/inheriti-elements-core/node';
import { BUILD_DEPLOYMENT, resolveConfiguration } from './configuration.js';
import { createExtensionCore } from './elements.js';
import { discoverOrganizations } from './organizations.js';
import { codeOf, loadPlans } from './plan-loader.js';
import { planIdFromUriPath, renderPlanDetail } from './plan-detail.js';
import { PlanTreeProvider } from './plan-tree.js';
import { messageFor, rowsFor } from './plan-view-model.js';
import type { PlanRow, PlanViewState } from './plan-view-model.js';
import { ActiveRevealRegistry } from './reveal.js';
import { createIdeSafeKeyPro } from './safekey-pro.js';
import { SecretSessionStore } from './session-store.js';
import { registerAuthCommands } from './commands/auth.js';
import { registerConfigurationCommands } from './commands/configuration.js';
import type { CommandContext } from './commands/context.js';
import { registerOrganizationCommands } from './commands/organization.js';
import { PLAN_SCHEME, registerPlanCommands } from './commands/plans.js';
import { notifyUpdate, registerUpdateCommands } from './commands/updates.js';

/** What `activate` returns to VS Code, and to anything inspecting the extension through its exports. */
export interface InheritiExtensionApi {
  /** The rows the plans view is showing right now — the same ones the tree paints. */
  currentRows(): readonly PlanRow[];
  refresh(): Promise<void>;
}

export function activate(context: vscode.ExtensionContext): InheritiExtensionApi {
  const plans = new PlanTreeProvider(context.globalStorageUri, () => keyOwner());
  let currentState: PlanViewState = { kind: 'SIGNED_OUT' };
  const render = (state: PlanViewState): void => { currentState = state; plans.render(state); };
  const sessions = new SecretSessionStore(context.secrets);
  const activeReveals = new ActiveRevealRegistry();
  let selectedOrganization: BusinessOrganization | undefined;
  const cachedCores = new Map<string, NodeIntegrationCore>();
  let revision = 0;
  const detailChanged = new vscode.EventEmitter<vscode.Uri>();

  const configuration = () => resolveConfiguration((key) => vscode.workspace.getConfiguration('inheriti').get<string>(key));
  const keyOwner = (): 'Application' | 'Organisation' => {
    try { return configuration().business ? 'Organisation' : 'Application'; }
    catch { return BUILD_DEPLOYMENT ? 'Organisation' : 'Application'; }
  };
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
      title: 'SafeKey PRO PIN', prompt: 'Enter the PIN so SafeKey PRO can save or provide this plan share.', password: true, ignoreFocusOut: true,
    }, token)),
    touch: (operation, attempt, limit) => { vscode.window.setStatusBarMessage(`SafeKey PRO ${operation} ${attempt}/${limit}: press and release the touch button.`, 30_000); },
  });
  const pickCustodianDevice = async (signal?: AbortSignal): Promise<'SK_MOBILE' | 'SK_PRO' | undefined> => {
    const choice = await withPromptCancellation(signal, (token) => vscode.window.showQuickPick([
      { label: custodianShareCopy.choice.mobileOption, description: custodianShareCopy.choice.mobileDescription, value: 'SK_MOBILE' as const },
      { label: custodianShareCopy.choice.proOption, description: custodianShareCopy.choice.proDescription, value: 'SK_PRO' as const },
    ], { title: custodianShareCopy.choice.title, placeHolder: custodianShareCopy.choice.intro, ignoreFocusOut: true }, token));
    if (choice?.value === 'SK_PRO') void vscode.window.showInformationMessage(custodianShareCopy.choice.proConnect);
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
      await refresh();
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

  const deps: CommandContext = {
    context, sessions, activeReveals, configuration, core, currentCore, changeOrganization,
    refresh, render, revision: () => revision, keyOwner, safeKeyPro, pickCustodianDevice,
  };
  context.subscriptions.push(
    activeReveals,
    detailChanged,
    vscode.window.registerTreeDataProvider('inheriti.plans', plans),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('inheriti')) {
        void sessions.clear().then(() => changeOrganization()).then(refresh);
      }
    }),
    vscode.workspace.registerTextDocumentContentProvider(PLAN_SCHEME, {
      onDidChange: detailChanged.event,
      provideTextDocumentContent: async (uri) => {
        const started = revision;
        try {
          const plan = await (await currentCore()).getPlan(planIdFromUriPath(uri.path));
          return started === revision ? renderPlanDetail(plan) : '';
        } catch (error) {
          return messageFor(codeOf(error), keyOwner());
        }
      },
    }),
    vscode.commands.registerCommand('inheriti.refresh', refresh),
    ...registerAuthCommands(deps),
    ...registerUpdateCommands(deps),
    ...registerOrganizationCommands(deps),
    ...registerConfigurationCommands(deps),
    ...registerPlanCommands(deps),
  );

  void refresh();
  void notifyUpdate(deps);

  return { currentRows: () => rowsFor(currentState, keyOwner()), refresh };
}

export function deactivate(): void {}
