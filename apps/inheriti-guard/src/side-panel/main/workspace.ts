import type { AccessBatch, AccessFieldResult, AccessFieldSuggestion, FieldMapping, PageFirstFieldCandidate, PageFieldTarget, ProtectedFieldRef } from '../../shared/access-contract.js';
import { validateAccessBatch } from '../../shared/access-contract.js';
import type { SidePanelRequest, SidePanelResponse } from '../../shared/messages.js';
import { compactButton, el, errorText, formatBytes, minutesUntil, remainingGate, required, resultLabel, suggestionReason, titleCase } from './dom.js';

export interface Workspace {
  readonly planId: string;
  readonly planName: string;
  readonly protectedFields: readonly ProtectedFieldRef[];
  readonly suggestions: readonly AccessFieldSuggestion[];
  batch?: AccessBatch;
}

export interface WorkspacePanelState {
  workspace: Workspace | undefined;
  revealRunning: boolean;
  pickerOpen: boolean;
  pageFirstCandidates: readonly PageFirstFieldCandidate[];
  resumablePlanId: string | undefined;
}

export function initializeWorkspacePanel(state: WorkspacePanelState, send: (request: SidePanelRequest) => Promise<SidePanelResponse>,
  onReloadPlans: () => void, refreshKeyStatus: () => Promise<void>,
  showPageFirstChooser: (target: PageFieldTarget, candidates: readonly PageFirstFieldCandidate[]) => void) {
  const resumeReveal = required<HTMLElement>('resume-reveal');
  const resumeRevealMessage = required('resume-reveal-message');
  const resumeRevealButton = required<HTMLButtonElement>('resume-reveal-button');
  const discardRevealButton = required<HTMLButtonElement>('discard-reveal-button');
  const accessDialog = required<HTMLDialogElement>('access-dialog');
  const closeAccess = required<HTMLButtonElement>('close-access');
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

  /**
   * A reveal the worker was evicted from is still open on the server, and the panel is where a person
   * finds out. Without this the process simply disappears: the phone keeps its request, the gates stay
   * cleared, and nothing on screen says so.
   */
  async function refreshResumable(): Promise<void> {
    const response = await send({ type: 'get-reveal-state' });
    const revealState = response.ok && 'reveal' in response ? response.reveal : undefined;
    const resumable = revealState?.kind === 'RESUMABLE' ? revealState : undefined;
    state.resumablePlanId = resumable?.planId;
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
    const planId = state.resumablePlanId;
    resumeReveal.hidden = true;
    if (planId !== undefined) void send({ type: 'abort-plan-access', planId }).then(() => refreshResumable());
  });

  function renderMappings(): void {
    if (state.workspace === undefined) return;
    const mappings = state.workspace.batch?.mappings ?? [];
    const mapped = new Map(mappings.map((mapping) => [mapping.protectedField.selector, mapping]));
    const suggested = new Map(state.workspace.suggestions.map((suggestion) => [suggestion.mapping.protectedField.selector, suggestion]));
    const groups = new Map<string, { name: string; type: string; fields: ProtectedFieldRef[] }>();
    for (const field of state.workspace.protectedFields) {
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
    confirmReveal.disabled = state.workspace.batch === undefined || !validateAccessBatch(state.workspace.batch).valid;
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
      const otherPlans = state.pageFirstCandidates.filter((candidate) => candidate.suggestion.mapping.pageTarget.targetId === mapping.pageTarget.targetId
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
    state.pickerOpen = true;
    accessStatus.textContent = `Select a ${titleCase(protectedField.fieldName)} field on the page. Press Escape to cancel.`;
    const response = await send({ type: 'start-page-field-picker', protectedField });
    state.pickerOpen = false;
    if (!response.ok && response.error === 'picker-canceled') {
      accessStatus.textContent = 'Field selection canceled.';
      return;
    }
    applyBatch(response, 'Page field selected.');
  }

  function applyBatch(response: SidePanelResponse, message: string): void {
    if (response.ok && 'batch' in response && state.workspace !== undefined) {
      state.workspace.batch = response.batch;
      accessStatus.textContent = message;
      renderMappings();
    } else accessStatus.textContent = response.ok ? 'The mapping could not be updated.' : errorText(response.error);
  }

  confirmReveal.addEventListener('click', () => {
    const batch = state.workspace?.batch;
    if (batch !== undefined && validateAccessBatch(batch).valid) void revealAndAutofill(batch);
  });

  async function revealAndAutofill(batch: AccessBatch): Promise<void> {
    state.revealRunning = true;
    confirmReveal.hidden = true;
    cancelReveal.hidden = false;
    abortAccess.hidden = false;
    closeAccess.disabled = true;
    mappingWorkspace.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    setRevealStatus('Opening the plan.');
    const pending = send({ type: 'reveal-and-autofill', batch });
    const poll = window.setInterval(() => { void refreshProgress(); }, 500);
    const response = await pending;
    void refreshKeyStatus();
    window.clearInterval(poll);
    state.revealRunning = false;
    closeAccess.disabled = false;
    cancelReveal.hidden = true;
    if (response.ok && 'results' in response) {
      renderResults(response.results, batch);
      const filled = response.results.filter((result) => result.code === 'filled').length;
      accessStatus.textContent = `${filled} of ${response.results.length} fields autofilled. Chrome did not submit the form.`;
    } else accessStatus.textContent = response.ok ? 'Autofill did not return field results.' : errorText(response.error);
    await showSafeKeyCapacityFailure();
    onReloadPlans();
    // A reveal that ended because this worker was evicted leaves a resumable one behind, not nothing.
    void refreshResumable();
  }

  async function showSafeKeyCapacityFailure(): Promise<void> {
    const response = await send({ type: 'get-reveal-state' });
    const deviceError = response.ok && 'reveal' in response
      ? response.reveal.kind === 'WARNING' ? response.reveal.detail
        : response.reveal.kind === 'ERROR' ? response.reveal.message : ''
      : '';
    if (deviceError.startsWith('SafeKey PRO has no free space.')) {
      const download = document.createElement('a');
      download.href = 'https://safekey.be/tools/safekey-desktop/';
      download.target = '_blank';
      download.rel = 'noopener noreferrer';
      download.textContent = 'Download SafeKey Desktop Tool';
      accessStatus.replaceChildren(document.createTextNode(deviceError), document.createElement('br'), download);
    }
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
    if (state.revealRunning) { accessStatus.textContent = 'Canceling reveal…'; void send({ type: 'cancel-reveal' }); }
  });
  abortAccess.addEventListener('click', () => {
    if (state.workspace === undefined) return;
    accessStatus.textContent = 'Aborting the open access…';
    void send({ type: 'abort-plan-access', planId: state.workspace.planId }).then((response) => {
      accessStatus.textContent = response.ok && 'reveal' in response && 'message' in response.reveal ? response.reveal.message : 'The access could not be aborted.';
    });
  });

  closeAccess.addEventListener('click', closeWorkspace);
  accessDialog.addEventListener('cancel', (event) => {
    if (state.revealRunning) {
      event.preventDefault();
      accessStatus.textContent = 'Cancel the reveal before closing this dialog.';
      cancelReveal.focus();
    } else void discardWorkspace();
  });
  accessDialog.addEventListener('click', (event) => { if (event.target === accessDialog && !state.revealRunning) closeWorkspace(); });
  function closeWorkspace(): void { if (!state.revealRunning) { accessDialog.close(); void discardWorkspace(); } }
  async function discardWorkspace(): Promise<void> {
    if (state.workspace === undefined && !state.pickerOpen) return;
    if (state.pickerOpen) await send({ type: 'cancel-page-field-picker' });
    state.pickerOpen = false;
    state.workspace = undefined;
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

  return { renderMappings, discardWorkspace, viewAssets, refreshResumable };
}
