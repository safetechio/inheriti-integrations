import { discoverPageFields, scopePageFields, type DiscoveredPageField } from '../page-inspection.js';
import { pickPageField } from '../page-picker.js';
import { PendingTabContextStore } from '../pending-tab-context.js';
import type { SidePanelResponse } from '../../shared/messages.js';
import { pageFirstSuggestions } from '../page-first-suggestions.js';
import { suggestFieldMappings } from '../field-suggestions.js';
import type { FieldMapping, ProtectedFieldRef } from '../../shared/access-contract.js';
import type { BrowserIntegrationCore } from '@safetech/inheriti-elements-core/browser';

export interface WorkspacePlan {
  readonly assets: readonly { readonly id: string; readonly code?: string; readonly name: string;
    readonly type?: string | { readonly kind: 'UNKNOWN'; readonly raw: string }; readonly isBinary: boolean;
    readonly fieldNames: readonly string[]; readonly matchOrigins?: readonly string[] }[];
}

export function createWorkspaceRuntime(deps: {
  pendingContext: PendingTabContextStore;
  core: () => Promise<BrowserIntegrationCore>;
  getOrganizationRevision: () => number;
  setAssetMappings: (tabId: number, selected: FieldMapping) => SidePanelResponse;
}) {
  const { pendingContext, core, getOrganizationRevision, setAssetMappings } = deps;
  async function authoritativeOverlayTarget(
    tabId: number,
    frameId: number,
    origin: string,
    claimed: import('../../shared/access-contract.js').PageFieldTarget,
  ) {
    // The content script cannot know Chrome-owned tab/frame ids. If a caller supplies them they must
    // match, but authority always comes from MessageSender and the content script in that exact frame.
    if ((claimed.tabId !== undefined && claimed.tabId !== tabId)
      || (claimed.frameId !== undefined && claimed.frameId !== frameId) || claimed.origin !== origin) return undefined;
    const discovered = await chrome.tabs.sendMessage(tabId, { type: 'inheriti-overlay-discover-targets' }, { frameId })
      .catch(() => undefined) as readonly Pick<DiscoveredPageField,
        'targetId' | 'origin' | 'navigationId' | 'semantic' | 'label'>[] | undefined;
    const exact = discovered?.find((target) => target.targetId === claimed.targetId && target.origin === origin
      && target.navigationId === claimed.navigationId && target.semantic === claimed.semantic && target.label === claimed.label);
    if (exact === undefined) return undefined;
    return {
      target: { ...exact, tabId, frameId },
      pageTargets: discovered!
        .filter((target) => target.origin === origin && target.navigationId === claimed.navigationId)
        .map((target) => ({ ...target, tabId, frameId })),
    };
  }

  async function discoverWorkspacePage(tabId: number, origin: string) {
    const injections = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: discoverPageFields });
    const snapshot = injections[0]?.result;
    if (snapshot === undefined || snapshot.origin !== origin
      || snapshot.fields.some((field) => field.origin !== origin || field.navigationId !== snapshot.navigationId)) return undefined;
    return { discovered: snapshot.fields, navigationId: snapshot.navigationId,
      pageTargets: scopePageFields(snapshot.fields, tabId, 0) };
  }

  async function loadPageFirstCandidates(tabId: number, origin: string): Promise<SidePanelResponse> {
    pendingContext.clearDraft();
    try {
      const client = await core();
      const [page, plansPage] = await Promise.all([
        discoverWorkspacePage(tabId, origin),
        client.listPlans({ assetType: 'USER-PSWD' }),
      ]);
      if (page === undefined) return { ok: false, error: 'stale-page-context' };
      const plans = await Promise.all(plansPage.items.map(async (summary) => ({
        id: summary.id, name: summary.name, plan: await client.getPlan(summary.id) as unknown as WorkspacePlan,
      })));
      const candidates = pageFirstSuggestions(plans.map(({ id, name, plan }) => ({
        planName: name, protectedFields: protectedFieldsOf(plan, id, origin),
      })), page.pageTargets);
      return { ok: true, pageTargets: page.pageTargets, candidates };
    } catch { return { ok: false, error: 'access-request-failed' }; }
  }

  async function startPageFirstPicker(tabId: number, origin: string): Promise<SidePanelResponse> {
    pendingContext.clearDraft();
    try {
      const [injection] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: pickPageField });
      const field = injection?.result;
      if (field === null) return { ok: false, error: 'picker-canceled' };
      if (field === undefined || field.origin !== origin) return { ok: false, error: 'stale-page-context' };
      const pageTarget = scopePageFields([field], tabId, 0)[0];
      if (pageTarget === undefined) return { ok: false, error: 'stale-page-context' };
      const client = await core();
      const plansPage = await client.listPlans({ assetType: 'USER-PSWD' });
      const plans = await Promise.all(plansPage.items.map(async (summary) => ({
        planName: summary.name,
        protectedFields: protectedFieldsOf(await client.getPlan(summary.id) as unknown as WorkspacePlan, summary.id, origin),
      })));
      return { ok: true, pageTargets: [pageTarget], candidates: pageFirstSuggestions(plans, [pageTarget]) };
    } catch { return { ok: false, error: 'stale-page-context' }; }
  }

  async function selectPageFirstCandidate(tabId: number, origin: string, mapping: FieldMapping, planName: string): Promise<SidePanelResponse> {
    const loaded = await loadAccessWorkspace(mapping.protectedField.planId, tabId, origin);
    if (!loaded.ok || !('protectedFields' in loaded)) return loaded;
    const selected = setAssetMappings(tabId, { ...mapping, source: 'MANUAL' });
    if (!selected.ok || !('batch' in selected)) return selected;
    return { ...loaded, batch: selected.batch, planName } as SidePanelResponse;
  }

  async function loadAccessWorkspace(planId: string, tabId: number, origin: string): Promise<SidePanelResponse> {
    const revision = getOrganizationRevision();
    const existing = pendingContext.getDraft(tabId);
    if (existing !== undefined && existing.identity.planId === planId) {
      return {
        ok: true,
        protectedFields: existing.protectedFields,
        pageTargets: existing.pageTargets,
        suggestions: [],
        batch: { identity: existing.identity, mappings: existing.mappings },
      };
    }
    pendingContext.clearDraft();
    try {
      const [plan, page] = await Promise.all([
        (await core()).getPlan(planId) as unknown as Promise<WorkspacePlan>,
        discoverWorkspacePage(tabId, origin),
      ]);
      if (page === undefined) return { ok: false, error: 'stale-page-context' };
      const protectedFields = protectedFieldsOf(plan, planId, origin);
      const pageTargets = page.pageTargets;
      const suggested = suggestFieldMappings({ planId, protectedFields, pageFields: suggestionFields(page.discovered, pageTargets) });
      if (!suggested.accepted) return { ok: false, error: 'access-request-failed' };
      const suggestedIds = suggested.suggestions.map(({ mapping }) => mapping.pageTarget.targetId);
      const orderedTargets = [...pageTargets].sort((left, right) => {
        const leftIndex = suggestedIds.indexOf(left.targetId);
        const rightIndex = suggestedIds.indexOf(right.targetId);
        return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
      });
    // Never publish A's discovered page fields after an account or organization transition.
    if (revision !== getOrganizationRevision()) return { ok: false, error: 'stale-page-context' };
      pendingContext.setDraft({
        identity: { planId, tabId, frameId: 0, origin, navigationId: page.navigationId }, protectedFields, pageTargets: orderedTargets, mappings: [],
      });
      return { ok: true, protectedFields, pageTargets: orderedTargets, suggestions: suggested.suggestions };
    } catch { return { ok: false, error: 'access-request-failed' }; }
  }

  /** Builds the same worker-owned workspace as the panel, scoped to the content script's exact frame. */
  async function loadOverlayWorkspace(
    planId: string,
    pageTargets: readonly import('../../shared/access-contract.js').PageFieldTarget[],
  ): Promise<SidePanelResponse> {
    const target = pageTargets[0];
    if (target === undefined) return { ok: false, error: 'stale-page-context' };
    const { tabId, frameId, origin, navigationId } = target;
    const revision = getOrganizationRevision();
    const existing = pendingContext.getDraft(tabId);
    if (existing !== undefined && existing.identity.planId === planId && existing.identity.origin === origin
      && existing.identity.frameId === frameId) {
      return {
        ok: true,
        protectedFields: existing.protectedFields,
        pageTargets: existing.pageTargets,
        suggestions: [],
        batch: { identity: existing.identity, mappings: existing.mappings },
      };
    }
    pendingContext.clearDraft();
    try {
      const plan = await (await core()).getPlan(planId) as unknown as WorkspacePlan;
      const protectedFields = protectedFieldsOf(plan, planId, origin);
      if (revision !== getOrganizationRevision()) return { ok: false, error: 'stale-page-context' };
      pendingContext.setDraft({
        identity: { planId, tabId, frameId, origin, navigationId }, protectedFields, pageTargets, mappings: [],
      });
      return { ok: true, protectedFields, pageTargets, suggestions: [] };
    } catch { return { ok: false, error: 'access-request-failed' }; }
  }

  function protectedFieldsOf(plan: WorkspacePlan, planId: string, origin: string): readonly ProtectedFieldRef[] {
    const allowed = new Set(['username', 'email', 'password']);
    return plan.assets.flatMap((asset) => asset.isBinary ? [] : asset.fieldNames
      .filter((fieldName): fieldName is ProtectedFieldRef['fieldName'] => allowed.has(fieldName))
      .map((fieldName) => ({ planId, assetId: asset.id, assetCode: asset.code ?? asset.id, assetName: asset.name,
        assetType: typeof asset.type === 'string' ? asset.type : asset.type?.raw ?? '', fieldName,
        selector: `${asset.code ?? asset.id}.${fieldName}`, matchesOrigin: asset.matchOrigins?.includes(origin) ?? false })))
      .sort((left, right) => Number(right.matchesOrigin) - Number(left.matchesOrigin) || left.selector.localeCompare(right.selector));
  }

  function suggestionFields(discovered: readonly DiscoveredPageField[], targets: ReturnType<typeof scopePageFields>) {
    const targetsById = new Map(targets.map((target) => [target.targetId, target]));
    return discovered.map((field) => ({ target: targetsById.get(field.targetId)!, autocomplete: field.autocomplete,
      inputType: field.inputType, accessibleLabel: field.label, name: field.name, elementId: field.elementId }));
  }

  return { authoritativeOverlayTarget, loadPageFirstCandidates, startPageFirstPicker,
    selectPageFirstCandidate, loadAccessWorkspace, loadOverlayWorkspace, protectedFieldsOf };
}
