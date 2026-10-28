import { scopePageFields } from '../page-inspection.js';
import { pickPageField } from '../page-picker.js';
import { createWorkspaceRuntime, type WorkspacePlan } from './workspace.js';
import { PendingTabContextStore } from '../pending-tab-context.js';
import type { OverlayRequest, SidePanelResponse } from '../../shared/messages.js';
import { pageFirstSuggestions } from '../page-first-suggestions.js';
import { validateAccessBatch, type AccessBatch, type FieldMapping, type ProtectedFieldRef } from '../../shared/access-contract.js';
import { OverlayPermissionController, secureOrigin } from '../overlay-permissions.js';
import { codeOf } from '../../shared/plan-view.js';
import type { BrowserIntegrationCore } from '@safetech/inheriti-elements-core/browser';
import type { ChromeRevealController } from '../reveal.js';
import type { GuardController } from '../guard/controller.js';

export function createAccessRuntime(deps: {
  pendingContext: PendingTabContextStore;
  reveal: ChromeRevealController;
  guard: GuardController;
  overlayPermissions: OverlayPermissionController;
  core: () => Promise<BrowserIntegrationCore>;
  revealRecovery: Promise<unknown>;
  getOrganizationRevision: () => number;
}) {
  const { pendingContext, reveal, guard, overlayPermissions, core, revealRecovery, getOrganizationRevision } = deps;
  const workspace = createWorkspaceRuntime({ pendingContext, core, getOrganizationRevision, setAssetMappings });
  async function respondOverlay(request: OverlayRequest, sender: chrome.runtime.MessageSender): Promise<SidePanelResponse> {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId ?? 0;
    const senderLocation = sender.tab?.url ?? sender.origin ?? sender.url;
    const origin = secureOrigin(sender.tab?.url) ?? secureOrigin(sender.origin) ?? secureOrigin(sender.url);
    if (tabId === undefined || origin === undefined
      || !await guard.allowsPlanAccess(sender.tab?.url ?? sender.url)
      || !(await overlayPermissions.state(origin)).currentEnabled) {
      return { ok: false, error: 'stale-page-context' };
    }
    await revealRecovery;
    // A permitted cross-origin iframe has its own authoritative origin. Do not replace the toolbar's
    // top-frame context; the worker-owned draft below carries the exact frame/origin identity.
    if (pendingContext.get(tabId) === undefined && senderLocation !== undefined) pendingContext.set(tabId, senderLocation);

    if (request.type === 'overlay-load-candidates') return loadOverlayCandidates(tabId, frameId, origin, request.target);

    if (request.type === 'overlay-discard-selection') {
      pendingContext.clearDraft();
      return { ok: true, discarded: true };
    }
    if (request.type === 'overlay-reveal-state') {
      await revealRecovery;
      return { ok: true, reveal: typeof request.planId === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.planId)
        ? await reveal.reconcile(request.planId) : reveal.current() };
    }
    if (request.type === 'overlay-cancel-reveal') return { ok: true, reveal: reveal.cancel() };
    if (request.type === 'overlay-cancel-pending-access') {
      if (typeof request.planId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.planId))
        return { ok: false, error: 'invalid-access-batch' };
      await revealRecovery;
      const state = await reveal.cancelPending(request.planId);
      if (state.kind === 'DONE') pendingContext.clearDraft();
      return { ok: true, reveal: state };
    }
    if (request.type === 'overlay-abort-plan-access') {
      if (typeof request.planId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.planId))
        return { ok: false, error: 'invalid-access-batch' };
      const state = await reveal.abortPlanAccess(request.planId);
      if (state.kind === 'DONE') pendingContext.clearDraft();
      return { ok: true, reveal: state };
    }
    if (request.type === 'overlay-resume-reveal') return { ok: true, reveal: await reveal.resume() };

    if (request.type === 'overlay-select-candidate') return selectOverlayCandidate(tabId, frameId, origin, request.mapping);

    // The side panel opens in the message listener itself, before this async boundary.
    if (request.type !== 'overlay-reveal-and-autofill') return { ok: false, error: 'stale-page-context' };
    const draft = pendingContext.getDraft(tabId);
    if (draft === undefined || JSON.stringify(request.batch) !== JSON.stringify({ identity: draft.identity, mappings: draft.mappings })) {
      return { ok: false, error: 'invalid-access-batch' };
    }
    return revealAndAutofill(tabId, origin, request.batch, 'OVERLAY');
  }

  async function loadOverlayCandidates(tabId: number, frameId: number, origin: string,
    target: import('../../shared/access-contract.js').PageFieldTarget): Promise<SidePanelResponse> {
    const page = await workspace.authoritativeOverlayTarget(tabId, frameId, origin, target);
    if (page === undefined) return { ok: false, error: 'stale-page-context' };
    try {
      const client = await core();
      // A page must be able to say "sign in" rather than "nothing matched" when nobody is signed in.
      if (!await client.getAccessToken()) return { ok: false, error: 'signed-out' };
      const plansPage = await client.listPlans({ assetType: 'USER-PSWD' });
      const summaries = plansPage.items;
      const plans = await Promise.all(summaries.map(async (summary) => ({
        planName: summary.name,
        protectedFields: workspace.protectedFieldsOf(await client.getPlan(summary.id) as unknown as WorkspacePlan, summary.id, origin),
      })));
      const draft = pendingContext.getDraft(tabId);
      const candidates = pageFirstSuggestions(plans, [page.target]);
      const emptyReason = summaries.length === 0
        ? 'no-autofill-plans'
        : plans.every(({ protectedFields }) => protectedFields.length === 0) ? 'no-protected-fields' : 'no-matching-field';
      return { ok: true, pageTargets: [page.target], candidates,
        ...(candidates.length === 0 ? { emptyReason } : {}),
        ...(draft === undefined ? {} : { batch: { identity: draft.identity, mappings: draft.mappings } }) };
    } catch (error) {
      // An expired or rejected session is a sign-in answer too, never an empty suggestion list.
      return { ok: false, error: codeOf(error) === 'operator_reauthentication_required' ? 'signed-out' : 'access-request-failed' };
    }
  }

  async function selectOverlayCandidate(tabId: number, frameId: number, origin: string,
    mapping: FieldMapping): Promise<SidePanelResponse> {
    const page = await workspace.authoritativeOverlayTarget(tabId, frameId, origin, mapping.pageTarget);
    if (page === undefined || JSON.stringify(page.target) !== JSON.stringify(mapping.pageTarget)) {
      return { ok: false, error: 'stale-page-context' };
    }
    const draft = pendingContext.getDraft(tabId);
    if (draft !== undefined && draft.identity.planId === mapping.protectedField.planId) {
      pendingContext.setDraft({ ...draft, pageTargets: page.pageTargets });
      return setAssetMappings(tabId, { ...mapping, source: 'MANUAL' });
    }
    const loaded = await workspace.loadOverlayWorkspace(mapping.protectedField.planId, page.pageTargets);
    if (!loaded.ok || !('protectedFields' in loaded)) return loaded;
    return setAssetMappings(tabId, { ...mapping, source: 'MANUAL' });
  }

  function setAccessMapping(tabId: number, mapping: FieldMapping): SidePanelResponse {
    const draft = pendingContext.getDraft(tabId);
    if (draft === undefined) return { ok: false, error: 'stale-page-context' };
    if (!sameProtectedField(draft.protectedFields, mapping.protectedField) || !samePageTarget(draft.pageTargets, mapping.pageTarget)
      || mapping.protectedField.fieldName !== mapping.pageTarget.semantic) return { ok: false, error: 'invalid-access-batch' };
    const mappings = draft.mappings.filter((current) => current.protectedField.selector !== mapping.protectedField.selector
      && current.pageTarget.targetId !== mapping.pageTarget.targetId);
    const batch = { identity: draft.identity, mappings: [...mappings, mapping] } satisfies AccessBatch;
    if (!validateAccessBatch(batch).valid) return { ok: false, error: 'invalid-access-batch' };
    pendingContext.updateMappings(tabId, batch.mappings);
    return { ok: true, batch };
  }

  function setAssetMappings(tabId: number, selected: FieldMapping): SidePanelResponse {
    const draft = pendingContext.getDraft(tabId);
    if (draft === undefined || !sameProtectedField(draft.protectedFields, selected.protectedField)
      || !samePageTarget(draft.pageTargets, selected.pageTarget)
      || selected.protectedField.fieldName !== selected.pageTarget.semantic) return { ok: false, error: 'invalid-access-batch' };
    const siblings = draft.protectedFields
      .filter((field) => field.assetId === selected.protectedField.assetId && field.selector !== selected.protectedField.selector)
      .flatMap((field): FieldMapping[] => {
        const targets = draft.pageTargets.filter((target) => target.semantic === field.fieldName
          && target.targetId !== selected.pageTarget.targetId);
        return targets.length === 1 ? [{ protectedField: field, pageTarget: targets[0]!, source: 'SUGGESTED' }] : [];
      });
    const batch = { identity: draft.identity, mappings: [selected, ...siblings] } satisfies AccessBatch;
    if (!validateAccessBatch(batch).valid) return { ok: false, error: 'invalid-access-batch' };
    pendingContext.updateMappings(tabId, batch.mappings);
    return { ok: true, batch };
  }

  async function startPicker(tabId: number, protectedField: ProtectedFieldRef): Promise<SidePanelResponse> {
    const revision = getOrganizationRevision();
    const draft = pendingContext.getDraft(tabId);
    if (draft === undefined || !sameProtectedField(draft.protectedFields, protectedField)) return { ok: false, error: 'invalid-access-batch' };
    try {
      const [injection] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [draft.identity.frameId] }, func: pickPageField });
      const field = injection?.result;
      if (field === null) return { ok: false, error: 'picker-canceled' };
      if (field === undefined || field.origin !== draft.identity.origin || field.navigationId !== draft.identity.navigationId) {
        pendingContext.clearDraft();
        return { ok: false, error: 'stale-page-context' };
      }
      if (revision !== getOrganizationRevision()) return { ok: false, error: 'stale-page-context' };
      const target = scopePageFields([field], tabId, draft.identity.frameId)[0]!;
      const knownTarget = draft.pageTargets.find((candidate) => candidate.targetId === target.targetId);
      if (knownTarget === undefined) pendingContext.setDraft({ ...draft, pageTargets: [...draft.pageTargets, target] });
      return setAccessMapping(tabId, { protectedField, pageTarget: target, source: 'MANUAL' });
    } catch { return { ok: false, error: 'stale-page-context' }; }
  }

  async function revealAndAutofill(tabId: number, origin: string, batch: AccessBatch,
    initiator: 'PANEL' | 'OVERLAY' = 'PANEL'): Promise<SidePanelResponse> {
    const draft = pendingContext.getDraft(tabId);
    if (draft === undefined || origin !== draft.identity.origin || !sameBatch(batch, draft.identity, draft.mappings)
      || !validateAccessBatch(batch).valid || batch.mappings.some((mapping) => mapping.protectedField.planId !== draft.identity.planId)) {
      return { ok: false, error: 'invalid-access-batch' };
    }
    try { return { ok: true, results: await reveal.fillBatch(batch, initiator) }; }
    catch (error) { return { ok: false, error: stableAccessError(error) }; }
    finally { pendingContext.clearDraft(); }
  }

  function batchResponse(tabId: number): SidePanelResponse {
    const draft = pendingContext.getDraft(tabId);
    return draft === undefined ? { ok: false, error: 'stale-page-context' }
      : { ok: true, batch: { identity: draft.identity, mappings: draft.mappings } };
  }

  function sameProtectedField(fields: readonly ProtectedFieldRef[], field: ProtectedFieldRef): boolean {
    return fields.some((candidate) => JSON.stringify(candidate) === JSON.stringify(field));
  }
  function samePageTarget(targets: readonly import('../../shared/access-contract.js').PageFieldTarget[], target: import('../../shared/access-contract.js').PageFieldTarget): boolean {
    return targets.some((candidate) => JSON.stringify(candidate) === JSON.stringify(target));
  }
  function sameBatch(batch: AccessBatch, identity: AccessBatch['identity'], mappings: readonly FieldMapping[]): boolean {
    return JSON.stringify(batch) === JSON.stringify({ identity, mappings });
  }
  function stableAccessError(error: unknown): 'invalid-access-batch' | 'access-request-failed' {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'invalid-access-batch'
      ? 'invalid-access-batch' : 'access-request-failed';
  }

  return { respondOverlay, loadPageFirstCandidates: workspace.loadPageFirstCandidates,
    startPageFirstPicker: workspace.startPageFirstPicker,
    selectPageFirstCandidate: workspace.selectPageFirstCandidate,
    loadAccessWorkspace: workspace.loadAccessWorkspace,
    setAccessMapping, startPicker, revealAndAutofill, batchResponse };
}
