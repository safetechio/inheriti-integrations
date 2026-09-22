import type { AccessBatch, AccessFieldResult, AccessFieldSuggestion, FieldMapping, PageFirstFieldCandidate, PageFieldTarget, ProtectedFieldRef } from '../shared/access-contract.js';
import { validateAccessBatch } from '../shared/access-contract.js';
import type { GuardRequest, GuardResponse, SidePanelRequest, SidePanelResponse } from '../shared/messages.js';
import { messageFor, rowsFor, type PanelState } from '../shared/plan-view.js';
import { inheritiGuardBrand, inheritiGuardShield, planAvatarSvg } from '@safetech/inheriti-elements-brand';
import type { GuardActivityEntry, GuardSettings } from '../shared/guard-contract.js';

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
const overlayStatus = required('overlay-status');
const overlayMessage = required('overlay-message');
const enableOverlay = required<HTMLButtonElement>('enable-overlay');
const disableOverlay = required<HTMLButtonElement>('disable-overlay');
const authorizedSites = required<HTMLElement>('authorized-sites');
const authorizedOriginList = required<HTMLUListElement>('authorized-origin-list');
const disableAllOverlays = required<HTMLButtonElement>('disable-all-overlays');
const signIn = required<HTMLButtonElement>('sign-in');
const signOut = required<HTMLButtonElement>('sign-out');
const signedOutError = required<HTMLParagraphElement>('signed-out-error');
const openOptions = required<HTMLButtonElement>('open-options');
const forgetKey = required<HTMLButtonElement>('forget-master-key');
const reloadPlans = required<HTMLButtonElement>('reload-plans');
const authStatus = required('auth-status');
const planTools = required<HTMLElement>('plan-tools');
const planFilter = required<HTMLInputElement>('plan-filter');
const plans = required<HTMLUListElement>('plans');
const accountArea = required<HTMLElement>('account-area');
const organizationChoice = required<HTMLElement>('organization-choice');
const organizationMenu = required<HTMLDetailsElement>('organization-menu');
const organizationSummary = required<HTMLElement>('organization-summary');
const organizationOptions = required<HTMLElement>('organization-options');
const organizationStatus = required<HTMLElement>('organization-status');
const resumeReveal = required<HTMLElement>('resume-reveal');
const resumeRevealMessage = required('resume-reveal-message');
const resumeRevealButton = required<HTMLButtonElement>('resume-reveal-button');
const discardRevealButton = required<HTMLButtonElement>('discard-reveal-button');
const accessDialog = required<HTMLDialogElement>('access-dialog');
const closeAccess = required<HTMLButtonElement>('close-access');
const accessPlan = required('access-plan');
const accessStatus = required('access-status');
const mappingWorkspace = required('mapping-workspace');
const revealProgress = required<HTMLOListElement>('reveal-progress');
const fieldResults = required<HTMLUListElement>('field-results');
const confirmReveal = required<HTMLButtonElement>('confirm-reveal');
const cancelReveal = required<HTMLButtonElement>('cancel-reveal');
const abortAccess = required<HTMLButtonElement>('abort-access');
const assetsDialog = required<HTMLDialogElement>('assets-dialog');
const closeMetadata = required<HTMLButtonElement>('close-metadata');
const assetMetadata = required<HTMLUListElement>('asset-metadata');

interface Workspace {
  readonly planId: string;
  readonly planName: string;
  readonly protectedFields: readonly ProtectedFieldRef[];
  readonly suggestions: readonly AccessFieldSuggestion[];
  batch?: AccessBatch;
}

const CONFIGURATION_CODES = new Set(['configuration_missing', 'master_key_salt_required', 'master_key_salt_unexpected']);

let workspace: Workspace | undefined;
let revealRunning = false;
let pickerOpen = false;
let pageFirstCandidates: readonly PageFirstFieldCandidate[] = [];
let currentOverlayOrigin: string | undefined;
let resumablePlanId: string | undefined;

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

async function refreshActiveContext(): Promise<void> {
  const response = await send({ type: 'get-active-context' });
  const context = response.ok && 'context' in response ? response.context : undefined;
  if (context === undefined) {
    origin.textContent = 'Reopen the panel from the toolbar on a supported page.';
    inspect.disabled = true;
    pickPageFieldButton.disabled = true;
    return;
  }
  origin.textContent = context.origin;
  inspect.disabled = false;
  pickPageFieldButton.disabled = false;
}

/**
 * The panel outlives the tab it was opened on, and its whole page-facing half is about that one tab.
 * Left alone it keeps describing a page nobody is looking at any more — an origin it cannot act on,
 * or a "secure HTTPS sites only" line about a tab that was replaced. So the tab is re-read whenever
 * the browser says it changed, and whenever the panel comes back into view.
 */
async function refreshPageState(): Promise<void> {
  await refreshActiveContext();
  await refreshOverlayPermissions();
}

void refreshPageState();
chrome.tabs.onActivated.addListener(() => { void refreshPageState(); });
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => { if (changeInfo.status === 'complete' || changeInfo.url !== undefined) void refreshPageState(); });
chrome.windows.onFocusChanged.addListener(() => { void refreshPageState(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshPageState(); });

enableOverlay.addEventListener('click', () => { void enableOverlayForCurrentSite(); });
disableOverlay.addEventListener('click', () => { void changeOverlayPermission('disable-overlay-origin', origin.textContent ?? ''); });
disableAllOverlays.addEventListener('click', () => {
  disableAllOverlays.disabled = true;
  void changeOverlayPermission('disable-all-overlays').finally(() => { disableAllOverlays.disabled = false; });
});

async function refreshOverlayPermissions(): Promise<void> {
  const response = await send({ type: 'get-overlay-permissions' });
  if (response.ok && 'overlay' in response) renderOverlayPermissions(response.overlay);
}

async function enableOverlayForCurrentSite(): Promise<void> {
  const enabledOrigin = currentOverlayOrigin;
  if (enabledOrigin === undefined) return;
  // Chrome requires permissions.request() in the extension page's direct user gesture. A runtime
  // message to the worker does not preserve that activation.
  const granted = await chrome.permissions.request({ origins: [`${enabledOrigin}/*`] });
  if (!granted) {
    overlayStatus.textContent = 'Side panel only'; overlayStatus.className = 'status neutral';
    overlayMessage.textContent = 'Site permission was not granted. All side-panel features remain available.';
    return;
  }
  await changeOverlayPermission('enable-overlay-current-origin');
}

async function changeOverlayPermission(
  type: 'enable-overlay-current-origin' | 'disable-overlay-origin' | 'disable-all-overlays',
  disabledOrigin?: string,
): Promise<void> {
  if (type === 'enable-overlay-current-origin') {
    overlayStatus.textContent = 'Updating'; overlayStatus.className = 'status busy';
  }
  const request = type === 'disable-overlay-origin'
    ? { type, origin: disabledOrigin ?? '' } as const
    : { type } as const;
  const response = await send(request).catch(() => undefined);
  const latest = await send({ type: 'get-overlay-permissions' }).catch(() => undefined);
  const state = latest?.ok && 'overlay' in latest ? latest.overlay
    : response?.ok && 'overlay' in response ? response.overlay : undefined;
  if (state !== undefined) {
    renderOverlayPermissions(state);
    const completed = type === 'disable-all-overlays' ? state.enabledOrigins.length === 0
      : type === 'disable-overlay-origin' ? !state.enabledOrigins.includes(disabledOrigin ?? '')
        : state.currentEnabled;
    if (completed) return;
  }
  overlayStatus.textContent = 'Needs attention'; overlayStatus.className = 'status neutral';
  overlayMessage.textContent = 'Could not update site access. Try again.';
}

function renderOverlayPermissions(state: { currentOrigin?: string; currentEnabled: boolean; enabledOrigins: readonly string[] }): void {
  currentOverlayOrigin = state.currentOrigin;
  const supported = state.currentOrigin !== undefined;
  if (state.currentOrigin !== undefined && origin.textContent?.startsWith('Checking')) origin.textContent = state.currentOrigin;
  overlayStatus.textContent = state.currentEnabled ? 'Enabled' : 'Side panel only';
  overlayStatus.className = `status ${state.currentEnabled ? 'success' : 'neutral'}`;
  overlayMessage.textContent = !supported
    ? 'Field controls are available only on secure HTTPS sites. Continue with the side panel.'
    : state.currentEnabled
      ? 'Inheriti controls are enabled beside compatible fields on this origin.'
      : 'Enable exact-origin access to add field controls. The side panel remains fully functional.';
  enableOverlay.hidden = !supported || state.currentEnabled;
  disableOverlay.hidden = !state.currentEnabled;
  authorizedSites.hidden = state.enabledOrigins.length === 0;
  authorizedOriginList.replaceChildren(...state.enabledOrigins.map((enabledOrigin) => {
    const item = el('li'); item.append(document.createTextNode(enabledOrigin));
    const revoke = compactButton('Disable'); revoke.classList.add('danger');
    revoke.addEventListener('click', () => {
      revoke.disabled = true;
      revoke.textContent = 'Disabling…';
      void changeOverlayPermission('disable-overlay-origin', enabledOrigin).finally(() => {
        revoke.disabled = false; revoke.textContent = 'Disable';
      });
    });
    item.append(revoke); return item;
  }));
}

pickPageFieldButton.addEventListener('click', () => { void pickFieldFromPage(); });

async function pickFieldFromPage(): Promise<void> {
  pickerOpen = true;
  pickPageFieldButton.disabled = true;
  status.textContent = 'Select a field on the page…';
  status.className = 'status busy';
  const response = await send({ type: 'start-page-first-picker' });
  pickerOpen = false;
  pickPageFieldButton.disabled = false;
  if (!response.ok || !('candidates' in response)) {
    status.textContent = !response.ok && response.error === 'picker-canceled' ? 'Selection canceled' : 'Page changed';
    status.className = 'status neutral';
    return;
  }
  const target = response.pageTargets[0];
  if (target === undefined) return;
  pageFirstCandidates = response.candidates;
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
  pageFirstCandidates = response.candidates;
  pageFieldList.replaceChildren(...response.pageTargets.map(pageFieldRow));
}

function pageFieldRow(target: PageFieldTarget): HTMLElement {
  const candidates = pageFirstCandidates.filter((candidate) => candidate.suggestion.mapping.pageTarget.targetId === target.targetId);
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
  if (workspace !== undefined && workspace.batch !== undefined
    && workspace.planId !== candidate.suggestion.mapping.protectedField.planId
    && !window.confirm(`Replace all current mappings from ${workspace.planName} with ${candidate.planName}?`)) {
    accessPlan.textContent = workspace.planName;
    accessStatus.textContent = 'Current plan mappings kept.';
    confirmReveal.hidden = false;
    renderMappings();
    return;
  }
  accessStatus.textContent = 'Creating plan-scoped mapping…';
  const response = await send({ type: 'select-page-first-candidate', mapping: candidate.suggestion.mapping, planName: candidate.planName });
  if (!response.ok || !('protectedFields' in response) || response.batch === undefined) {
    accessStatus.textContent = response.ok ? 'The mapping could not be created.' : errorText(response.error);
    return;
  }
  workspace = { planId: candidate.suggestion.mapping.protectedField.planId, planName: candidate.planName,
    protectedFields: response.protectedFields, suggestions: response.suggestions, batch: response.batch };
  accessPlan.textContent = candidate.planName;
  accessStatus.textContent = 'Plan selected from the page field. Add or review mappings before revealing.';
  confirmReveal.hidden = false;
  renderMappings();
}

/** API values are assigned through textContent and are never interpreted as markup. */
function renderPanel(state: PanelState): void {
  const organizations = state.organizations;
  const keyOwner = organizations === undefined ? 'Application' : 'Organisation';
  forgetKey.title = `Drop the ${keyOwner} key held in memory. The next reveal asks for it again.`;
  const needsOrganization = state.kind === 'SELECT_ORGANIZATION';
  organizationChoice.hidden = organizations === undefined;
  planAccessPanel.dataset.organization = needsOrganization ? 'required' : 'selected';
  if (organizations !== undefined) {
    organizationMenu.open = false;
    organizationSummary.textContent = organizations.find(({ id }) => id === state.organizationId)?.name ?? 'Choose an organization';
    organizationOptions.replaceChildren(...organizations.map(({ id, name }) => {
      const option = el('button', 'organization-option', name) as HTMLButtonElement;
      option.type = 'button';
      option.dataset.selected = String(id === state.organizationId);
      option.setAttribute('aria-current', id === state.organizationId ? 'true' : 'false');
      option.addEventListener('click', () => {
        organizationMenu.open = false;
        organizationOptions.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = true; });
        organizationStatus.textContent = 'Switching organization…';
        void send({ type: 'select-organization', organizationId: id }).then((response) => {
          if (response.ok && 'state' in response) renderPanel(response.state);
          else { organizationOptions.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = false; }); organizationStatus.textContent = 'Could not switch organization. Try again.'; }
        });
      });
      return option;
    }));
    organizationStatus.textContent = needsOrganization
      ? state.reason ?? (organizations.length === 0 ? 'No active organizations are available.' : 'Select one to view its plans.')
      : '';
  }
  plans.dataset.state = state.kind;
  plans.replaceChildren(...rowsFor(state).map((row) => {
    const item = el('li');
    if (state.kind === 'PLANS') item.dataset.planRow = '';
    const heading = el('div', 'plan-row-heading');
    const planStatus = row.detail.toUpperCase();
    const tone = row.draft ? 'draft'
      : ['PROTECTED', 'ACTIVE', 'CONFIGURED', 'COMPLETED', 'DATA_RELEASED', 'DATA_REVEALED', 'ACCESS_GRANTED'].includes(planStatus) ? 'ready'
        : ['FAILED', 'ABORTED'].includes(planStatus) ? 'danger'
          : /^(MERGING_|PENDING|SHARES_|VALIDATOR_SHARES_|CUSTODIAN_SHARE_|EXPIRED$)/u.test(planStatus) ? 'warning' : 'neutral';
    const identity = el('div', 'plan-row-identity');
    if (row.avatarId) {
      const avatar = el('img', 'plan-avatar') as HTMLImageElement;
      avatar.alt = '';
      avatar.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(planAvatarSvg(row.avatarId))}`;
      identity.append(avatar);
    }
    identity.append(el('span', 'plan-label', row.label));
    heading.append(identity, el('span', `plan-detail ${tone}`, titleCase(row.detail)));
    item.append(heading);
    if (row.draft) item.append(el('span', 'plan-hint', 'Finish setup in Inheriti® Business to access this plan.'));
    if (row.planId !== undefined) {
      item.dataset.planId = row.planId;
      const actions = el('div', 'plan-actions');
      const access = actionButton('Access', 'primary');
      access.addEventListener('click', () => { void loadWorkspace(row.planId as string, row.label); });
      const assets = actionButton('View assets', 'secondary');
      assets.addEventListener('click', () => { void viewAssets(row.planId as string); });
      actions.append(access, assets);
      item.append(actions);
    }
    return item;
  }));
  applyFilter();
  const signedIn = state.kind === 'LOADING' || state.kind === 'EMPTY' || state.kind === 'PLANS' || needsOrganization;
  appMain.dataset.authenticated = String(signedIn);
  planAccessPanel.dataset.authenticated = String(signedIn);
  authStatus.textContent = state.kind === 'SIGNING_IN' ? 'Signing in' : state.kind === 'ERROR' ? 'Needs attention' : signedIn ? 'Signed in' : 'Signed out';
  accessHeaderStatus.textContent = `Plan Access: ${state.kind === 'SIGNING_IN' ? 'signing in' : state.kind === 'ERROR' ? 'needs attention' : signedIn ? 'signed in' : 'signed out'}`;
  signIn.hidden = signedIn;
  signIn.disabled = state.kind === 'SIGNING_IN';
  signIn.textContent = state.kind === 'SIGNING_IN' ? 'Signing in…' : 'Sign in';
  accountArea.hidden = !signedIn;
  signOut.hidden = !signedIn;
  // The plans list carries an error only once signed in; before that this is the one place to say it.
  signedOutError.hidden = state.kind !== 'ERROR';
  signedOutError.textContent = state.kind === 'ERROR' ? messageFor(state.code) : '';
  // Sign-in needs a configured plan service, so an unconfigured
  // extension offers the page that configures it instead of a sign-in that cannot succeed.
  const needsConfiguration = state.kind === 'ERROR' && CONFIGURATION_CODES.has(state.code);
  openOptions.hidden = !needsConfiguration;
  signIn.hidden = signedIn || needsConfiguration;
  planTools.hidden = !signedIn || needsOrganization;
  forgetKey.hidden = !signedIn;
}

const guardEnabled = required<HTMLInputElement>('guard-enabled');
const guardSensitiveApi = required<HTMLInputElement>('guard-sensitive-api');
const guardClipboard = required<HTMLInputElement>('guard-clipboard');
const guardIdleLock = required<HTMLInputElement>('guard-idle-lock');
const guardIdleMinutes = required<HTMLInputElement>('guard-idle-minutes');
const guardDownloadTrap = required<HTMLInputElement>('guard-download-trap');
const guardHeaderStatus = required('guard-header-status');
const accessHeaderStatus = required('access-header-status');
const guardLiveStatus = required('guard-live-status');
const activityList = required<HTMLUListElement>('activity-list');
const migrationNotice = required<HTMLElement>('migration-notice');

function renderGuard(settings: GuardSettings): void {
  guardEnabled.checked = settings.isEnabled;
  guardSensitiveApi.checked = settings.apiBlockingEnabled;
  guardClipboard.checked = settings.clipboardGuardEnabled;
  guardIdleLock.checked = settings.idleLockEnabled;
  guardIdleMinutes.value = String(settings.idleLockMinutes);
  guardIdleMinutes.disabled = !settings.idleLockEnabled;
  guardDownloadTrap.checked = settings.downloadTrapEnabled;
  guardHeaderStatus.textContent = `Protection: ${settings.isEnabled ? 'active' : 'off'}`;
  guardHeaderStatus.dataset.active = String(settings.isEnabled);
}

async function mutateGuard(request: GuardRequest): Promise<void> {
  guardLiveStatus.textContent = 'Updating Browser Protection…';
  const response = await sendGuard(request);
  if (response.ok && 'guard' in response) {
    renderGuard(response.guard);
    guardLiveStatus.textContent = 'Browser Protection updated.';
  } else guardLiveStatus.textContent = 'Browser Protection could not be updated.';
}

guardEnabled.addEventListener('change', () => { void mutateGuard({ type: 'guard:set-protection', enabled: guardEnabled.checked }); });
guardSensitiveApi.addEventListener('change', () => { void mutateGuard({ type: 'guard:set-sensitive-api', enabled: guardSensitiveApi.checked }); });
guardClipboard.addEventListener('change', () => { void mutateGuard({ type: 'guard:set-clipboard', enabled: guardClipboard.checked }); });
guardIdleLock.addEventListener('change', () => { void mutateGuard({ type: 'guard:set-idle-lock', enabled: guardIdleLock.checked }); });
guardIdleMinutes.addEventListener('change', () => {
  const minutes = Math.min(120, Math.max(1, Number.parseInt(guardIdleMinutes.value, 10) || 1));
  void mutateGuard({ type: 'guard:set-idle-minutes', minutes });
});
guardDownloadTrap.addEventListener('change', () => { void mutateGuard({ type: 'guard:set-download-trap', enabled: guardDownloadTrap.checked }); });

required<HTMLButtonElement>('secure-logoff').addEventListener('click', () => {
  if (!window.confirm('Secure Logoff will end Plan Access work, close Inheriti sessions, and clear scoped session data. Continue?')) return;
  void sendGuard({ type: 'guard:secure-logoff' }).then(() => { guardLiveStatus.textContent = 'Secure Logoff complete.'; void requestState('load-plans'); });
});

function activityLabel(kind: GuardActivityEntry['kind']): string {
  return ({ 'navigation-blocked': 'Navigation blocked', 'clipboard-blocked': 'Clipboard protected',
    'download-blocked': 'Download blocked', 'csp-violation': 'Page policy violation observed',
    'sensitive-api-blocked': 'Sensitive API blocked', 'idle-lock': 'Idle lock',
    'secure-logoff': 'Secure Logoff' })[kind];
}
function renderActivity(entries: readonly GuardActivityEntry[]): void {
  activityList.replaceChildren(...(entries.length === 0 ? [el('li', 'empty-activity', 'No protection activity yet.')] : entries.map((entry) => {
    const item = el('li', 'activity-entry');
    const heading = el('div', 'activity-entry-heading');
    heading.append(el('strong', '', activityLabel(entry.kind)), el('time', '', new Date(entry.timestamp).toLocaleString()));
    item.append(heading);
    const location = safeActivityLocation(entry.origin, entry.pathname);
    if (location !== '') item.append(el('p', '', location));
    if (entry.detail !== undefined) item.append(el('p', 'activity-detail', entry.detail));
    return item;
  })));
}
function safeActivityLocation(origin?: string, pathname?: string): string {
  const cleanOrigin = origin === undefined ? '' : origin.split(/[?#]/u, 1)[0]!;
  const cleanPath = pathname === undefined ? '' : pathname.split(/[?#]/u, 1)[0]!;
  return `${cleanOrigin}${cleanPath}`;
}
async function refreshActivity(): Promise<void> {
  const response = await sendGuard({ type: 'activity:list' });
  if (response.ok && 'activity' in response) renderActivity(response.activity);
  else renderActivity([]);
}
required<HTMLButtonElement>('activity-tab').addEventListener('click', () => { void refreshActivity(); });
required<HTMLButtonElement>('clear-activity').addEventListener('click', () => { void sendGuard({ type: 'activity:clear' }).then(() => renderActivity([])); });

const MIGRATION_NOTICE_KEY = 'inheritiguardUnifiedNoticeDismissed';
try { migrationNotice.hidden = localStorage.getItem(MIGRATION_NOTICE_KEY) === 'true'; } catch { migrationNotice.hidden = false; }
required<HTMLButtonElement>('dismiss-migration').addEventListener('click', () => {
  migrationNotice.hidden = true;
  try { localStorage.setItem(MIGRATION_NOTICE_KEY, 'true'); } catch { /* The notice stays dismissed for this panel lifetime. */ }
});
void sendGuard({ type: 'guard:get-state' }).then((response) => { if (response.ok && 'guard' in response) renderGuard(response.guard); });

function applyFilter(): void {
  const query = planFilter.value.trim().toLocaleLowerCase();
  plans.querySelectorAll<HTMLLIElement>('li[data-plan-row]').forEach((item) => {
    item.hidden = query !== '' && !item.textContent?.toLocaleLowerCase().includes(query);
  });
}

async function requestState(type: 'sign-in' | 'sign-out' | 'load-plans' | 'forget-master-key'): Promise<void> {
  const response = await send({ type });
  if (response.ok && 'state' in response) renderPanel(response.state);
}

planFilter.addEventListener('input', applyFilter);
signIn.addEventListener('click', () => { renderPanel({ kind: 'SIGNING_IN' }); void requestState('sign-in'); });
openOptions.addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });
signOut.addEventListener('click', () => { void discardWorkspace(); void requestState('sign-out'); });
forgetKey.addEventListener('click', () => { void requestState('forget-master-key'); });
reloadPlans.addEventListener('click', () => { renderPanel({ kind: 'LOADING' }); void requestState('load-plans'); });
organizationMenu.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { organizationMenu.open = false; organizationSummary.focus(); }
});
document.addEventListener('click', (event) => {
  if (!organizationMenu.contains(event.target as Node)) organizationMenu.open = false;
});
void requestState('load-plans');
void refreshResumable();

/**
 * A reveal the worker was evicted from is still open on the server, and the panel is where a person
 * finds out. Without this the process simply disappears: the phone keeps its request, the gates stay
 * cleared, and nothing on screen says so.
 */
async function refreshResumable(): Promise<void> {
  const response = await send({ type: 'get-reveal-state' });
  const state = response.ok && 'reveal' in response ? response.reveal : undefined;
  const resumable = state?.kind === 'RESUMABLE' ? state : undefined;
  resumablePlanId = resumable?.planId;
  resumeRevealMessage.textContent = resumable?.message ?? '';
  resumeReveal.hidden = resumable === undefined;
}

resumeRevealButton.addEventListener('click', () => {
  resumeRevealButton.disabled = true;
  resumeRevealMessage.textContent = 'Resuming the open reveal…';
  void send({ type: 'resume-reveal' }).then((response) => {
    resumeRevealButton.disabled = false;
    resumeRevealMessage.textContent = response.ok && 'reveal' in response && 'message' in response.reveal
      ? response.reveal.message
      : 'The reveal could not be resumed.';
    void refreshResumable();
  });
});

// Giving the access up rather than taking it back up. Both are real answers, and only the operator
// knows which one this is; the reveal is not thrown away on their behalf.
discardRevealButton.addEventListener('click', () => {
  const planId = resumablePlanId;
  resumeReveal.hidden = true;
  if (planId !== undefined) void send({ type: 'abort-plan-access', planId }).then(() => refreshResumable());
});

async function loadWorkspace(planId: string, planName: string): Promise<void> {
  await discardWorkspace();
  workspace = { planId, planName, protectedFields: [], suggestions: [] };
  accessPlan.textContent = planName;
  accessStatus.textContent = 'Discovering compatible fields on this page…';
  mappingWorkspace.replaceChildren();
  revealProgress.replaceChildren();
  revealProgress.hidden = true;
  fieldResults.replaceChildren();
  fieldResults.hidden = true;
  confirmReveal.hidden = false;
  confirmReveal.disabled = true;
  cancelReveal.hidden = true;
  abortAccess.hidden = true;
  closeAccess.disabled = false;
  if (!accessDialog.open) accessDialog.showModal();
  const response = await send({ type: 'load-access-workspace', planId });
  if (!response.ok || !('protectedFields' in response)) {
    accessStatus.textContent = response.ok ? 'The access workspace could not be loaded.' : errorText(response.error);
    return;
  }
  workspace = { planId, planName, protectedFields: response.protectedFields, suggestions: response.suggestions,
    ...(response.batch === undefined ? {} : { batch: response.batch }) };
  accessStatus.textContent = response.protectedFields.length === 0
    ? 'This plan has no fields that Chrome can autofill.'
    : response.batch === undefined
      ? 'Review each suggestion. You can accept, replace, or remove mappings before revealing.'
      : 'Mappings started on the page are ready here. Review them before revealing.';
  renderMappings();
}

function renderMappings(): void {
  if (workspace === undefined) return;
  const mappings = workspace.batch?.mappings ?? [];
  const mapped = new Map(mappings.map((mapping) => [mapping.protectedField.selector, mapping]));
  const suggested = new Map(workspace.suggestions.map((suggestion) => [suggestion.mapping.protectedField.selector, suggestion]));
  const groups = new Map<string, { name: string; type: string; fields: ProtectedFieldRef[] }>();
  for (const field of workspace.protectedFields) {
    const group = groups.get(field.assetId) ?? { name: field.assetName, type: field.assetType, fields: [] };
    group.fields.push(field);
    groups.set(field.assetId, group);
  }
  mappingWorkspace.replaceChildren(...[...groups.values()].map((group) => {
    const section = el('section', 'mapping-asset');
    const heading = el('div', 'mapping-asset-heading');
    heading.append(el('strong', '', group.name), el('span', 'asset-type-badge', titleCase(group.type)));
    section.append(heading, ...group.fields.map((field) => mappingRow(field, mapped.get(field.selector), suggested.get(field.selector))));
    return section;
  }));
  confirmReveal.disabled = workspace.batch === undefined || !validateAccessBatch(workspace.batch).valid;
}

function mappingRow(field: ProtectedFieldRef, mapping?: FieldMapping, suggestion?: AccessFieldSuggestion): HTMLElement {
  const row = el('div', 'mapping-row');
  const heading = el('div', 'mapping-row-heading');
  heading.append(el('strong', '', titleCase(field.fieldName)));
  const source = mapping?.source ?? suggestion?.mapping.source;
  if (source !== undefined) heading.append(el('span', `mapping-source ${source.toLocaleLowerCase()}`, titleCase(source)));
  row.append(heading, el('p', 'mapping-target', (mapping?.pageTarget ?? suggestion?.mapping.pageTarget)?.label ?? 'No compatible page field found'));
  if (suggestion !== undefined && mapping === undefined) {
    row.append(el('p', 'mapping-confidence', `${titleCase(suggestion.confidence)} confidence · ${suggestionReason(suggestion.reason)}`));
  }
  const actions = el('div', 'mapping-actions');
  if (mapping === undefined && suggestion !== undefined) {
    const accept = compactButton('Accept suggestion');
    accept.addEventListener('click', () => { void updateMapping(suggestion.mapping); });
    actions.append(accept);
  }
  const pick = compactButton(mapping === undefined ? 'Select field on page' : 'Replace');
  pick.addEventListener('click', () => { void startPicker(field); });
  actions.append(pick);
  if (mapping !== undefined) {
    const remove = compactButton('Remove', 'danger');
    remove.addEventListener('click', () => { void removeMapping(field.selector); });
    actions.append(remove);
    const otherPlans = pageFirstCandidates.filter((candidate) => candidate.suggestion.mapping.pageTarget.targetId === mapping.pageTarget.targetId
      && candidate.suggestion.mapping.protectedField.planId !== field.planId);
    if (otherPlans.length > 0) {
      const changePlan = compactButton('Change plan');
      changePlan.addEventListener('click', () => { showPageFirstChooser(mapping.pageTarget, otherPlans); });
      actions.append(changePlan);
    }
  }
  row.append(actions);
  return row;
}

async function updateMapping(mapping: FieldMapping): Promise<void> {
  accessStatus.textContent = 'Saving mapping…';
  applyBatch(await send({ type: 'set-access-mapping', mapping }), 'Mapping saved.');
}

async function removeMapping(selector: string): Promise<void> {
  accessStatus.textContent = 'Removing mapping…';
  applyBatch(await send({ type: 'remove-access-mapping', selector }), 'Mapping removed.');
}

async function startPicker(protectedField: ProtectedFieldRef): Promise<void> {
  pickerOpen = true;
  accessStatus.textContent = `Select a ${titleCase(protectedField.fieldName)} field on the page. Press Escape to cancel.`;
  const response = await send({ type: 'start-page-field-picker', protectedField });
  pickerOpen = false;
  if (!response.ok && response.error === 'picker-canceled') {
    accessStatus.textContent = 'Field selection canceled.';
    return;
  }
  applyBatch(response, 'Page field selected.');
}

function applyBatch(response: SidePanelResponse, message: string): void {
  if (response.ok && 'batch' in response && workspace !== undefined) {
    workspace.batch = response.batch;
    accessStatus.textContent = message;
    renderMappings();
  } else accessStatus.textContent = response.ok ? 'The mapping could not be updated.' : errorText(response.error);
}

confirmReveal.addEventListener('click', () => {
  const batch = workspace?.batch;
  if (batch !== undefined && validateAccessBatch(batch).valid) void revealAndAutofill(batch);
});

async function revealAndAutofill(batch: AccessBatch): Promise<void> {
  revealRunning = true;
  confirmReveal.hidden = true;
  cancelReveal.hidden = false;
  abortAccess.hidden = false;
  closeAccess.disabled = true;
  mappingWorkspace.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  setRevealStatus('Opening the plan.');
  const pending = send({ type: 'reveal-and-autofill', batch });
  const poll = window.setInterval(() => { void refreshProgress(); }, 500);
  const response = await pending;
  window.clearInterval(poll);
  revealRunning = false;
  closeAccess.disabled = false;
  cancelReveal.hidden = true;
  if (response.ok && 'results' in response) {
    renderResults(response.results, batch);
    const filled = response.results.filter((result) => result.code === 'filled').length;
    accessStatus.textContent = `${filled} of ${response.results.length} fields autofilled. Chrome did not submit the form.`;
  } else accessStatus.textContent = response.ok ? 'Autofill did not return field results.' : errorText(response.error);
  // A reveal that ended because this worker was evicted leaves a resumable one behind, not nothing.
  void refreshResumable();
}

async function refreshProgress(): Promise<void> {
  const response = await send({ type: 'get-reveal-state' });
  if (!response.ok || !('reveal' in response) || response.reveal.kind !== 'RUNNING') return;
  appendStep(response.reveal.message);
  const countdown = response.reveal.gateExpiresAt !== undefined
    ? ` ${remainingGate(response.reveal.gateExpiresAt)}`
    : response.reveal.expiresAt === undefined ? '' : ` Data will be accessible for ${minutesUntil(response.reveal.expiresAt)}.`;
  accessStatus.textContent = `${response.reveal.message}${countdown}`;
}

function renderResults(results: readonly AccessFieldResult[], batch: AccessBatch): void {
  const labels = new Map(batch.mappings.map((mapping) => [mapping.protectedField.selector, `${mapping.protectedField.assetName} · ${titleCase(mapping.protectedField.fieldName)}`]));
  fieldResults.replaceChildren(...results.map((result) => {
    const item = el('li', `field-result ${result.code === 'filled' ? 'success' : 'failed'}`);
    item.append(el('span', '', labels.get(result.selector) ?? 'Protected field'), el('strong', '', resultLabel(result.code)));
    return item;
  }));
  fieldResults.hidden = false;
}

function setRevealStatus(message: string): void { accessStatus.textContent = message; appendStep(message); }
function appendStep(message: string): void {
  const last = revealProgress.lastElementChild;
  if (last?.textContent === message) return;
  last?.classList.remove('current');
  last?.classList.add('complete');
  const item = el('li', 'current', message);
  revealProgress.append(item);
  revealProgress.hidden = false;
  item.scrollIntoView({ block: 'nearest' });
}

cancelReveal.addEventListener('click', () => {
  if (revealRunning) { accessStatus.textContent = 'Canceling reveal…'; void send({ type: 'cancel-reveal' }); }
});
abortAccess.addEventListener('click', () => {
  if (workspace === undefined) return;
  accessStatus.textContent = 'Aborting the open access…';
  void send({ type: 'abort-plan-access', planId: workspace.planId }).then((response) => {
    accessStatus.textContent = response.ok && 'reveal' in response && 'message' in response.reveal ? response.reveal.message : 'The access could not be aborted.';
  });
});

closeAccess.addEventListener('click', closeWorkspace);
accessDialog.addEventListener('cancel', (event) => {
  if (revealRunning) {
    event.preventDefault();
    accessStatus.textContent = 'Cancel the reveal before closing this dialog.';
    cancelReveal.focus();
  } else void discardWorkspace();
});
accessDialog.addEventListener('click', (event) => { if (event.target === accessDialog && !revealRunning) closeWorkspace(); });
function closeWorkspace(): void { if (!revealRunning) { accessDialog.close(); void discardWorkspace(); } }
async function discardWorkspace(): Promise<void> {
  if (workspace === undefined && !pickerOpen) return;
  if (pickerOpen) await send({ type: 'cancel-page-field-picker' });
  pickerOpen = false;
  workspace = undefined;
  await send({ type: 'discard-access-workspace' });
}

closeMetadata.addEventListener('click', () => { assetsDialog.close(); });
assetsDialog.addEventListener('click', (event) => { if (event.target === assetsDialog) assetsDialog.close(); });
async function viewAssets(planId: string): Promise<void> {
  assetMetadata.replaceChildren(el('li', 'asset-metadata-message', 'Loading assets…'));
  if (!assetsDialog.open) assetsDialog.showModal();
  const response = await send({ type: 'load-plan-assets', planId });
  if (!response.ok || !('assets' in response)) {
    assetMetadata.replaceChildren(el('li', 'asset-metadata-message', 'Assets could not be loaded.'));
    return;
  }
  assetMetadata.replaceChildren(...response.assets.map((asset) => {
    const item = el('li');
    const heading = el('div', 'asset-metadata-heading');
    heading.append(el('strong', '', asset.name), el('span', 'asset-type-badge', titleCase(asset.type)));
    const detail = asset.isBinary
      ? [asset.fileName, asset.mimeType, asset.size === undefined ? undefined : formatBytes(asset.size)].filter(Boolean).join(' · ')
      : asset.fieldNames.length === 0 ? 'No declared fields' : `Fields: ${asset.fieldNames.map(titleCase).join(', ')}`;
    item.append(heading, el('p', '', detail));
    return item;
  }));
}

function errorText(error: string): string {
  if (error === 'no-active-tab') return 'Open Access from a supported web page.';
  if (error === 'stale-tab-context' || error === 'stale-page-context') return 'The page changed. Reopen Access and try again.';
  if (error === 'invalid-access-batch') return 'The mappings are no longer valid. Review them and try again.';
  if (error === 'plan-request-failed') return 'The plan could not be loaded. Check your session and try again.';
  return 'The access request could not be completed.';
}
function resultLabel(code: AccessFieldResult['code']): string {
  return ({ filled: 'Autofilled', 'authorization-denied': 'Not allowed on this site', 'field-unavailable': 'Protected field unavailable', 'invalid-value': 'Value not compatible', 'stale-page-context': 'Page changed', 'destination-failed': 'Could not autofill', canceled: 'Canceled', 'not-attempted': 'Not attempted' })[code];
}
function suggestionReason(reason: AccessFieldSuggestion['reason']): string {
  return ({ 'exact-origin': 'exact origin match', autocomplete: 'autocomplete match', 'input-type': 'input type match', 'accessible-label': 'accessible label match', name: 'field name match', id: 'field id match', 'inferred-semantic': 'inferred field type' })[reason];
}
function remainingGate(deadline: string): string {
  const seconds = Math.ceil(Math.max(0, new Date(deadline).getTime() - Date.now()) / 1_000);
  return `Time remaining ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.`;
}
function minutesUntil(deadline: string): string {
  const minutes = Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 60_000));
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function titleCase(value: string): string {
  return value.toLocaleLowerCase().replace(/(^|[_\s-])([a-z])/gu, (_match, separator: string, letter: string) => `${separator === '_' ? ' ' : separator}${letter.toLocaleUpperCase()}`);
}
function actionButton(label: string, kind: 'primary' | 'secondary'): HTMLButtonElement {
  const button = compactButton(label);
  button.className = `button ${kind} plan-action`;
  return button;
}
function compactButton(label: string, kind = ''): HTMLButtonElement {
  const button = el('button', `compact-button ${kind}`.trim(), label);
  button.type = 'button';
  return button;
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function send(request: SidePanelRequest): Promise<SidePanelResponse> { return chrome.runtime.sendMessage(request) as Promise<SidePanelResponse>; }
function sendGuard(request: GuardRequest): Promise<GuardResponse> { return chrome.runtime.sendMessage(request) as Promise<GuardResponse>; }
function required<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`Missing side-panel element: ${id}`);
  return node as T;
}
