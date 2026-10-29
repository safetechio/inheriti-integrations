import type { PageFirstFieldCandidate, PageFieldTarget } from '../shared/access-contract.js';
import type { SidePanelRequest, SidePanelResponse } from '../shared/messages.js';
import { messageFor, type PanelState } from '../shared/plan-view.js';
import { inheritiGuardBrand, inheritiGuardShield } from '@safetech/inheriti-elements-brand';
import { MASTER_KEY_CACHE_PREFIX } from '../shared/stored-configuration.js';
import { confirmedPanelState, startAccountAddition } from './account-context.js';
import { compactButton, el, errorText, required, titleCase } from './main/dom.js';
import { initializeOverlayPanel } from './main/overlay.js';
import { initializeGuardPanel } from './main/guard.js';
import { renderAccounts } from './main/accounts.js';
import { initializeWorkspacePanel, type WorkspacePanelState } from './main/workspace.js';
import { organizationDisplayName } from './main/organizations.js';
import { createKeyStatusRefresh } from './main/key-status.js';
import { planRows } from './main/plans.js';

const origin = required('origin');
const appMain = required<HTMLElement>('app-main');
const planAccessPanel = required<HTMLElement>('plan-access-panel');
const panelTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.plan-tabs [role="tab"]'));
const productTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.product-tabs [role="tab"]'));
const inspect = required<HTMLButtonElement>('inspect');
const pickPageFieldButton = required<HTMLButtonElement>('pick-page-field');
const status = required('status');
const summary = required<HTMLElement>('summary');
const usernameCount = required('username-count');
const passwordCount = required('password-count');
const pageFieldList = required('page-field-list');
const signIn = required<HTMLButtonElement>('sign-in');
const signOut = required<HTMLButtonElement>('sign-out');
const signOutAll = required<HTMLButtonElement>('sign-out-all');
const signedOutError = required<HTMLParagraphElement>('signed-out-error');
const openOptions = required<HTMLButtonElement>('open-options');
const forgetKey = required<HTMLButtonElement>('forget-master-key');
const reloadPlans = required<HTMLButtonElement>('reload-plans');
const authStatus = required('auth-status');
const accessHeaderStatus = required('access-header-status');
const planTools = required<HTMLElement>('plan-tools');
const planFilter = required<HTMLInputElement>('plan-filter');
const plans = required<HTMLUListElement>('plans');
const accountArea = required<HTMLElement>('account-area');
const addAccount = required<HTMLButtonElement>('add-account');
const accountList = required<HTMLUListElement>('account-list');
const accountStatus = required<HTMLParagraphElement>('account-status');
const accountMenu = accountList.closest<HTMLDetailsElement>('.account-menu');
if (accountMenu === null) throw new Error('Missing account menu');
const accountTrigger = accountArea.querySelector<HTMLElement>('.account-trigger');
if (accountTrigger === null) throw new Error('Missing account trigger');
const organizationChoice = required<HTMLElement>('organization-choice');
const organizationMenu = required<HTMLDetailsElement>('organization-menu');
const organizationSummary = required<HTMLElement>('organization-summary');
const organizationOptions = required<HTMLElement>('organization-options');
const organizationStatus = required<HTMLElement>('organization-status');
const accessDialog = required<HTMLDialogElement>('access-dialog');
const accessPlan = required('access-plan');
const accessAccount = required('access-account');
const accessStatus = required('access-status');
const mappingWorkspace = required('mapping-workspace');
const revealProgress = required<HTMLOListElement>('reveal-progress');
const fieldResults = required<HTMLUListElement>('field-results');
const confirmReveal = required<HTMLButtonElement>('confirm-reveal');
const abortAccess = required<HTMLButtonElement>('abort-access');
const assetsDialog = required<HTMLDialogElement>('assets-dialog');

const workspaceState: WorkspacePanelState = {
  workspace: undefined, revealRunning: false, pickerOpen: false, pageFirstCandidates: [], resumablePlanId: undefined,
};
const CONFIGURATION_CODES = new Set(['configuration_missing', 'master_key_salt_required', 'master_key_salt_unexpected']);

let panelGeneration: number | undefined;
let contextRevision = 0;
let reconfirming = false;

document.documentElement.style.setProperty('--primary', inheritiGuardBrand.colors.primary);
document.documentElement.style.setProperty('--primary-dark', inheritiGuardBrand.colors.primaryDark);
document.documentElement.style.setProperty('--primary-soft', inheritiGuardBrand.colors.primarySoft);
document.querySelectorAll<SVGPathElement>('.brand-mark path, .signed-out-mark path').forEach((path) => path.setAttribute('d', inheritiGuardShield.path));

for (const tab of productTabs) {
  tab.addEventListener('click', () => activateTabs(productTabs, tab));
  tab.addEventListener('keydown', (event: KeyboardEvent) => moveTabFocus(productTabs, tab, event));
}

for (const tab of panelTabs) {
  tab.addEventListener('click', () => activateTabs(panelTabs, tab));
  tab.addEventListener('keydown', (event: KeyboardEvent) => moveTabFocus(panelTabs, tab, event));
}

function moveTabFocus(tabs: HTMLButtonElement[], tab: HTMLButtonElement, event: KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const current = tabs.indexOf(tab);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
    : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  activateTabs(tabs, tabs[next]!); tabs[next]!.focus();
}

function activateTabs(tabs: HTMLButtonElement[], active: HTMLButtonElement): void {
  for (const tab of tabs) {
    const selected = tab === active;
    tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    required<HTMLElement>(tab.getAttribute('aria-controls')!).hidden = !selected;
  }
}

initializeOverlayPanel(send);

pickPageFieldButton.addEventListener('click', () => { void pickFieldFromPage(); });

async function pickFieldFromPage(): Promise<void> {
  workspaceState.pickerOpen = true;
  pickPageFieldButton.disabled = true;
  status.textContent = 'Select a field on the page…';
  status.className = 'status busy';
  const response = await send({ type: 'start-page-first-picker' });
  workspaceState.pickerOpen = false;
  pickPageFieldButton.disabled = false;
  if (!response.ok || !('candidates' in response)) {
    status.textContent = !response.ok && response.error === 'picker-canceled' ? 'Selection canceled' : 'Page changed';
    status.className = 'status neutral';
    return;
  }
  const target = response.pageTargets[0];
  if (target === undefined) return;
  workspaceState.pageFirstCandidates = response.candidates;
  status.textContent = 'Field selected';
  status.className = 'status success';
  showPageFirstChooser(target, response.candidates);
}

inspect.addEventListener('click', () => {
  inspect.disabled = true;
  status.textContent = 'Inspecting…';
  status.className = 'status busy';
  void send({ type: 'inspect-active-page' }).then((response) => {
    if (!response.ok || !('summary' in response)) {
      status.textContent = 'Context expired';
      status.className = 'status neutral';
      origin.textContent = 'Reopen the panel from the toolbar.';
      return;
    }
    origin.textContent = response.summary.origin;
    usernameCount.textContent = String(response.summary.usernameFields);
    passwordCount.textContent = String(response.summary.passwordFields);
    summary.hidden = false;
    status.textContent = 'Inspected';
    status.className = 'status success';
    inspect.disabled = false;
    void loadPageFirstCandidates();
  });
});

async function loadPageFirstCandidates(): Promise<void> {
  pageFieldList.hidden = false;
  pageFieldList.replaceChildren(el('p', 'page-field-message', 'Finding protected-field suggestions…'));
  const response = await send({ type: 'load-page-first-candidates' });
  if (!response.ok || !('candidates' in response)) {
    pageFieldList.replaceChildren(el('p', 'page-field-message', response.ok ? 'No page fields found.' : errorText(response.error)));
    return;
  }
  workspaceState.pageFirstCandidates = response.candidates;
  pageFieldList.replaceChildren(...response.pageTargets.map(pageFieldRow));
}

function pageFieldRow(target: PageFieldTarget): HTMLElement {
  const candidates = workspaceState.pageFirstCandidates.filter((candidate) => candidate.suggestion.mapping.pageTarget.targetId === target.targetId);
  const row = el('div', 'page-field-row');
  const copy = el('div');
  copy.append(el('strong', '', target.label), el('span', '', `${titleCase(target.semantic)} · ${candidates.length} protected suggestion${candidates.length === 1 ? '' : 's'}`));
  const choose = compactButton('Choose asset');
  choose.disabled = candidates.length === 0;
  choose.addEventListener('click', () => { showPageFirstChooser(target, candidates); });
  row.append(copy, choose);
  return row;
}

function showPageFirstChooser(target: PageFieldTarget, candidates: readonly PageFirstFieldCandidate[]): void {
  accessPlan.textContent = target.label;
  accessStatus.textContent = `Choose a protected ${titleCase(target.semantic)} field. Exact origin matches appear first.`;
  revealProgress.hidden = true;
  fieldResults.hidden = true;
  confirmReveal.hidden = true;
  abortAccess.hidden = true;
  mappingWorkspace.replaceChildren(...candidates.map((candidate) => {
    const field = candidate.suggestion.mapping.protectedField;
    const card = el('section', 'mapping-asset page-first-candidate');
    const heading = el('div', 'mapping-asset-heading');
    heading.append(el('strong', '', candidate.planName), el('span', 'asset-type-badge', field.matchesOrigin ? 'Exact origin' : 'Compatible'));
    card.append(heading, el('p', 'mapping-target', `${field.assetName} · ${titleCase(field.fieldName)}`));
    const select = compactButton('Use this asset');
    select.addEventListener('click', () => { void selectPageFirstCandidate(candidate); });
    const actions = el('div', 'mapping-actions'); actions.append(select); card.append(actions);
    return card;
  }));
  if (!accessDialog.open) accessDialog.showModal();
}

async function selectPageFirstCandidate(candidate: PageFirstFieldCandidate): Promise<void> {
  if (workspaceState.workspace !== undefined && workspaceState.workspace.batch !== undefined
    && workspaceState.workspace.planId !== candidate.suggestion.mapping.protectedField.planId
    && !window.confirm(`Replace all current mappings from ${workspaceState.workspace.planName} with ${candidate.planName}?`)) {
    accessPlan.textContent = workspaceState.workspace.planName;
    accessStatus.textContent = 'Current plan mappings kept.';
    confirmReveal.hidden = false;
    workspacePanel.renderMappings();
    return;
  }
  accessStatus.textContent = 'Creating plan-scoped mapping…';
  const response = await send({ type: 'select-page-first-candidate', mapping: candidate.suggestion.mapping, planName: candidate.planName });
  if (!response.ok || !('protectedFields' in response) || response.batch === undefined) {
    accessStatus.textContent = response.ok ? 'The mapping could not be created.' : errorText(response.error);
    return;
  }
  workspaceState.workspace = { planId: candidate.suggestion.mapping.protectedField.planId, planName: candidate.planName,
    protectedFields: response.protectedFields, suggestions: response.suggestions, batch: response.batch };
  accessPlan.textContent = candidate.planName;
  accessStatus.textContent = 'Plan selected from the page field. Add or review mappings before revealing.';
  confirmReveal.hidden = false;
  workspacePanel.renderMappings();
}

/** API values are assigned through textContent and are never interpreted as markup. */
function renderKeyStatus(keyOwner: 'Application' | 'Organization', loaded: boolean): void {
  forgetKey.textContent = `Clear ${keyOwner.toLowerCase()} key`;
  forgetKey.title = loaded ? `Clear the ${keyOwner.toLowerCase()} key from memory. You'll need to load it again before the next reveal.` : '';
  forgetKey.disabled = !loaded;
  forgetKey.hidden = !loaded || planAccessPanel.dataset.authenticated !== 'true';
}

const refreshKeyStatus = createKeyStatusRefresh(send,
  () => ({ revision: contextRevision, kind: plans.dataset.state }), renderKeyStatus);

function renderPanel(state: PanelState): void {
  if (state.generation !== undefined) panelGeneration = state.generation;
  accountStatus.textContent = '';
  required('session-skeleton').hidden = true;
  planAccessPanel.setAttribute('aria-busy', 'false');
  const accounts = state.accounts ?? [];
  planAccessPanel.dataset.hasAccounts = String(accounts.length > 0);
  renderAccounts(accountList, accounts, accountAction);
  const activeAccount = accounts.find((account) => account.active);
  const activeOrganization = state.organizations?.find((organization) => organization.id === state.organizationId);
  accessAccount.textContent = activeAccount === undefined ? ''
    : `${activeAccount.label}${activeOrganization === undefined ? '' : ` · ${organizationDisplayName(activeOrganization, state.organizations ?? [])}`}`;
  const organizations = state.organizations;
  renderKeyStatus(organizations === undefined ? 'Application' : 'Organization', Boolean(state.keyInMemory));
  renderOrganizationChoice(state);
  plans.dataset.state = state.kind;
  plans.replaceChildren(...planRows(state, (planId) => { void workspacePanel.viewAssets(planId); }));
  applyFilter();
  renderAuthenticationState(state, accounts.length);
  if (state.kind === 'EMPTY' || state.kind === 'PLANS') void refreshKeyStatus();
}

function renderOrganizationChoice(state: PanelState): void {
  const organizations = state.organizations;
  const hasActiveAccount = state.accounts?.some((account) => account.active) === true;
  const needsOrganization = state.kind === 'SELECT_ORGANIZATION' && hasActiveAccount;
  organizationChoice.hidden = organizations === undefined || !hasActiveAccount;
  planAccessPanel.dataset.organization = needsOrganization ? 'required' : 'selected';
  if (organizations === undefined) return;
  organizationMenu.open = false;
  const selected = organizations.find(({ id }) => id === state.organizationId);
  organizationSummary.textContent = selected === undefined ? 'Choose an organization' : organizationDisplayName(selected, organizations);
  organizationOptions.replaceChildren(...organizations.map(({ id, name }) => {
    const option = el('button', 'organization-option', organizationDisplayName({ id, name }, organizations)) as HTMLButtonElement;
    option.type = 'button';
    option.dataset.selected = String(id === state.organizationId);
    option.setAttribute('aria-current', id === state.organizationId ? 'true' : 'false');
    option.addEventListener('click', () => {
      organizationMenu.open = false;
      void accountAction({ type: 'select-organization', organizationId: id });
    });
    return option;
  }));
  organizationStatus.textContent = needsOrganization
    ? state.reason ?? (organizations.length === 0 ? 'No active organizations are available.' : 'Select one to view its plans.')
    : '';
}

function renderAuthenticationState(state: PanelState, accountCount: number): void {
  const hasActiveAccount = state.accounts?.some((account) => account.active) === true;
  const needsOrganization = state.kind === 'SELECT_ORGANIZATION' && hasActiveAccount;
  const signedIn = hasActiveAccount && (state.kind === 'LOADING' || state.kind === 'EMPTY' || state.kind === 'PLANS' || needsOrganization);
  appMain.dataset.authenticated = String(signedIn);
  planAccessPanel.dataset.authenticated = String(signedIn);
  authStatus.textContent = state.kind === 'SIGNING_IN' ? 'Signing in' : state.kind === 'ERROR' ? 'Needs attention' : signedIn ? 'Signed in' : 'Signed out';
  accessHeaderStatus.textContent = `Plan Access: ${state.kind === 'SIGNING_IN' ? 'signing in' : state.kind === 'ERROR' ? 'needs attention' : signedIn ? 'signed in' : 'signed out'}`;
  signIn.hidden = signedIn;
  signIn.disabled = state.kind === 'SIGNING_IN';
  signIn.textContent = state.kind === 'SIGNING_IN' ? 'Signing in…' : 'Sign in';
  accountArea.hidden = !signedIn && accountCount === 0;
  signOut.hidden = !signedIn || accountCount !== 1;
  signOutAll.hidden = !signedIn || accountCount <= 1;
  // The plans list carries an error only once signed in; before that this is the one place to say it.
  signedOutError.hidden = state.kind !== 'ERROR';
  signedOutError.textContent = state.kind === 'ERROR' ? messageFor(state.code, Boolean(state.organizationId)) : '';
  // Sign-in needs a configured plan service, so an unconfigured
  // extension offers the page that configures it instead of a sign-in that cannot succeed.
  const needsConfiguration = state.kind === 'ERROR' && CONFIGURATION_CODES.has(state.code);
  openOptions.hidden = !needsConfiguration;
  signIn.hidden = signedIn || needsConfiguration;
  addAccount.disabled = state.kind === 'LOADING' || state.kind === 'SIGNING_IN' || needsConfiguration;
  planTools.hidden = !signedIn || needsOrganization;
  forgetKey.hidden = !signedIn || needsOrganization || state.kind === 'LOADING' || forgetKey.disabled;
}

async function accountAction(request: Extract<SidePanelRequest, { type: 'switch-account' | 'remove-account' | 'select-account-organization' | 'select-organization' | 'sign-out' }>, confirmation?: string): Promise<void> {
  if (confirmation !== undefined && !window.confirm(confirmation)) return;
  const startedRevision = contextRevision;
  renderPanel({ kind: 'LOADING' });
  planAccessPanel.setAttribute('aria-busy', 'true');
  if (accessDialog.open) accessDialog.close();
  if (assetsDialog.open) assetsDialog.close();
  try {
    await workspacePanel.discardWorkspace();
    const response = await send(request);
    if (startedRevision !== contextRevision) return;
    if (response.ok && 'state' in response) { renderPanel(response.state); return; }
  } catch { /* Recheck the server-owned active account before rendering protected content. */ }
  try {
    const current = await send({ type: 'load-plans' });
    if (startedRevision !== contextRevision) return;
    if (current.ok && 'state' in current) { renderPanel(current.state); accountStatus.textContent = 'Could not change account. Try again.'; return; }
  } catch { /* The worker may be unavailable; leave protected content hidden. */ }
  renderPanel({ kind: 'ERROR', code: 'plan_request_failed' });
}

initializeGuardPanel(() => { void requestState('load-plans'); });

function applyFilter(): void {
  const query = planFilter.value.trim().toLocaleLowerCase();
  plans.querySelectorAll<HTMLLIElement>('li[data-plan-row]').forEach((item) => {
    item.hidden = query !== '' && !item.textContent?.toLocaleLowerCase().includes(query);
  });
}

async function requestState(type: 'sign-in' | 'sign-out' | 'load-plans' | 'forget-master-key', restoreAccountOnFailure = false): Promise<void> {
  const startedRevision = contextRevision;
  const hadActiveAccount = planAccessPanel.dataset.authenticated === 'true';
  const hadSavedAccounts = accountList.children.length > 0;
  try {
    const response = await send({ type });
    if (startedRevision !== contextRevision) return;
    if (response.ok && 'state' in response && (type !== 'sign-in' || response.state.kind !== 'ERROR' || (!restoreAccountOnFailure && !hadActiveAccount && !hadSavedAccounts))) {
      renderPanel(response.state);
      return;
    }
  } catch {
    // Reconfirm the previous account after an interrupted Add Account attempt.
  }
  if (type === 'sign-in' && (restoreAccountOnFailure || hadActiveAccount || hadSavedAccounts)) {
    const current = await send({ type: 'load-plans' }).catch(() => undefined);
    if (startedRevision !== contextRevision) return;
    if (current?.ok && 'state' in current) {
      renderPanel(current.state);
      accountStatus.textContent = 'Could not add account. Try again.';
      return;
    }
  }
  renderPanel({ kind: 'ERROR', code: type === 'sign-in' ? 'sign_in_failed' : 'plan_request_failed' });
}

planFilter.addEventListener('input', applyFilter);
signIn.addEventListener('click', () => { renderPanel({ kind: 'SIGNING_IN' }); void requestState('sign-in'); });
addAccount.addEventListener('click', () => { void addAnotherAccount(); });
async function addAnotherAccount(): Promise<void> {
  if (!window.confirm('Add another account? This clears your SafeID browser sign-in, even if canceled. Other apps may ask you to sign in again; saved Inheriti® Guard accounts stay available.')) return;
  const startedRevision = contextRevision;
  if (accessDialog.open) accessDialog.close();
  if (assetsDialog.open) assetsDialog.close();
  renderPanel({ kind: 'SIGNING_IN' });
  await startAccountAddition(() => workspacePanel.discardWorkspace(),
    () => startedRevision === contextRevision,
    () => requestState('sign-in', true),
    async () => { await requestState('load-plans'); accountStatus.textContent = 'Could not close the current workspace. Try again.'; });
}
openOptions.addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });
signOut.addEventListener('click', () => { void accountAction({ type: 'sign-out' }, 'Sign out this SafeID account?'); });
forgetKey.addEventListener('click', () => { void requestState('forget-master-key'); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session') return;
  if (['inheriti.activeOperatorProfile', 'inheriti.operatorSessionGeneration']
    .some((key) => changes[key] !== undefined)) {
    contextRevision += 1;
    workspaceState.workspace = undefined;
    workspaceState.pickerOpen = false;
    if (accessDialog.open) accessDialog.close();
    if (assetsDialog.open) assetsDialog.close();
    renderPanel({ kind: 'LOADING' });
    planAccessPanel.setAttribute('aria-busy', 'true');
    void reconfirmAccountContext();
  }
  if (Object.keys(changes).some((key) => key.startsWith(MASTER_KEY_CACHE_PREFIX))) void refreshKeyStatus();
});
async function reconfirmAccountContext(): Promise<void> {
  if (reconfirming) return;
  reconfirming = true;
  try {
    let checkedRevision: number;
    do {
      checkedRevision = contextRevision;
      const state = await confirmedPanelState(() => send({ type: 'load-plans' }), () => checkedRevision === contextRevision);
      if (checkedRevision !== contextRevision) continue;
      renderPanel(state ?? { kind: 'ERROR', code: 'plan_request_failed' });
    } while (checkedRevision !== contextRevision);
  } finally { reconfirming = false; }
}
reloadPlans.addEventListener('click', () => { renderPanel({ kind: 'LOADING' }); void requestState('load-plans'); });
organizationMenu.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { organizationMenu.open = false; organizationSummary.focus(); }
});
accountMenu.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { accountMenu.open = false; accountTrigger.focus(); }
});
document.addEventListener('click', (event) => {
  if (!organizationMenu.contains(event.target as Node)) organizationMenu.open = false;
  if (!accountMenu.contains(event.target as Node)) accountMenu.open = false;
});
const workspacePanel = initializeWorkspacePanel(workspaceState, send,
  () => { void requestState('load-plans'); }, refreshKeyStatus, showPageFirstChooser);
void requestState('load-plans');
void workspacePanel.refreshResumable();
function send(request: SidePanelRequest): Promise<SidePanelResponse> {
  if (request.type !== 'load-plans' && reconfirming) return Promise.reject(new Error('account_context_changed'));
  const message = request.type !== 'load-plans' && panelGeneration !== undefined
    ? Object.assign({}, request, { expectedGeneration: panelGeneration }) : request;
  return chrome.runtime.sendMessage(message) as Promise<SidePanelResponse>;
}
