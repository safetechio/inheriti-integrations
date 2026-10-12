// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const useFindSelectedOrganizationPlanCreationTeamsByCriteria = vi.fn();
const useFindActiveOrganizationPlanCategoriesByCriteria = vi.fn();
const useFindActiveOrganizationMembersByCriteria = vi.fn();
const useGetCurrentMember = vi.fn();
const useGetMasterKeyConfigurationStatus = vi.fn();
const useGetOrganizationPlanCreationStorageLayerSummary = vi.fn();
const useGetRawSelectedOrganizationId = vi.fn();
const useAuthenticatedCookieSession = vi.fn();
const useService = vi.fn();
const usePlanCreationOrgPolicy = vi.fn();
const useMasterKeySession = vi.fn();
const useVerifyMasterKeyPassphrase = vi.fn();
const useGetMasterKeySeed = vi.fn();

vi.mock('@shared/infrastructure/importer-api', async () => {
  const actual = await vi.importActual<typeof import('@shared/infrastructure/importer-api')>(
    '@shared/infrastructure/importer-api',
  );
  return {
    ...actual,
    useAuthenticatedCookieSession: (...args: unknown[]) => useAuthenticatedCookieSession(...args),
    useService: (...args: unknown[]) => useService(...args),
  };
});

vi.mock('@modules/organization/infrastructure/importer-api', async () => {
  const actual = await vi.importActual<
    typeof import('@modules/organization/infrastructure/importer-api')
  >('@modules/organization/infrastructure/importer-api');
  return {
    ...actual,
    useFindSelectedOrganizationPlanCreationTeamsByCriteria: (...args: unknown[]) =>
      useFindSelectedOrganizationPlanCreationTeamsByCriteria(...args),
    useFindActiveOrganizationPlanCategoriesByCriteria: (...args: unknown[]) =>
      useFindActiveOrganizationPlanCategoriesByCriteria(...args),
    useFindActiveOrganizationMembersByCriteria: (...args: unknown[]) =>
      useFindActiveOrganizationMembersByCriteria(...args),
    useGetCurrentMember: (...args: unknown[]) => useGetCurrentMember(...args),
    useGetMasterKeyConfigurationStatus: (...args: unknown[]) =>
      useGetMasterKeyConfigurationStatus(...args),
    useGetOrganizationPlanCreationStorageLayerSummary: (...args: unknown[]) =>
      useGetOrganizationPlanCreationStorageLayerSummary(...args),
    useGetRawSelectedOrganizationId: (...args: unknown[]) =>
      useGetRawSelectedOrganizationId(...args),
    usePlanCreationOrgPolicy: (...args: unknown[]) => usePlanCreationOrgPolicy(...args),
    useMasterKeySession: (...args: unknown[]) => useMasterKeySession(...args),
    useVerifyMasterKeyPassphrase: (...args: unknown[]) => useVerifyMasterKeyPassphrase(...args),
    useGetMasterKeySeed: (...args: unknown[]) => useGetMasterKeySeed(...args),
  };
});

vi.mock('@safetech/inheriti-core-sdk/core', () => ({
  DataAssetDefinitionService: class {
    getCoreDefinitions() {
      return [];
    }
  },
  decryptRSAOAEP: vi.fn().mockResolvedValue('a'.repeat(64)),
  computePassphraseVerifier: vi.fn().mockResolvedValue('verifier'),
  deriveMasterKey: vi.fn(),
  encryptRSAOAEP: vi.fn(),
}));

import {
  usePlanBatchController,
  type PlanBatchControllerState,
} from '@modules/batch/application/use-plan-batch-controller';
import { makePlanDraft, type PlanDraft } from '@modules/plans/domain/workspace-model';
import { SensitiveValue, type ImportSession } from '@modules/import/domain/import-model';
import type { ImportTelemetryEvent, ImportTelemetrySink } from '@shared/infrastructure/telemetry';

function validPlan(clientId: string, name = 'Plan'): PlanDraft {
  const plan = makePlanDraft(clientId, name);
  // The governance floor (`getPlanTemplatePolicyViolation`) requires at
  // least one control regardless of org policy flags.
  plan.governance.moderatedAccess = true;
  plan.assets = [
    {
      id: `${clientId}-asset-1`,
      type: 'PLAIN-TEXT',
      name: 'Secret',
      fieldBindings: { 'secret.text': { kind: 'literal', value: new SensitiveValue('s3cr3t') } },
    },
  ];
  return plan;
}

function session(): ImportSession {
  return { id: 'session-1', sources: [], rootNodeIds: [], nodesById: {}, fieldsById: {} };
}

function policy() {
  return {
    privateAllowed: true,
    authRequired: false,
    moderationRequired: false,
    approvalModePerPlan: true,
    approvalMode: 'THRESHOLD' as const,
    organizationApprovalMode: 'PER_PLAN' as const,
    autoModeratorOwner: false,
    enabledMethods: {},
    authThreshold: 'per_plan' as const,
  };
}

function stubBaseHooks(
  overrides: {
    storageActiveDataStorageLayerCount?: number;
    organizationKeyReady?: boolean;
    localOrganizationKey?: string | null;
  } = {},
) {
  useGetRawSelectedOrganizationId.mockReturnValue({ data: 'org-1' });
  useAuthenticatedCookieSession.mockReturnValue({
    session: { sessionFamilyId: 'family-1', userId: 'user-1' },
  });
  const localOrganizationKey = Object.hasOwn(overrides, 'localOrganizationKey')
    ? overrides.localOrganizationKey
    : 'a'.repeat(64);
  useService.mockReturnValue({
    get: vi.fn().mockResolvedValue(localOrganizationKey),
    set: vi.fn().mockResolvedValue(undefined),
    clearOrganization: vi.fn().mockResolvedValue(undefined),
    clearSession: vi.fn().mockResolvedValue(undefined),
    clearAllSessions: vi.fn().mockResolvedValue(undefined),
  });
  useGetCurrentMember.mockReturnValue({ member: { id: 'member-1' } });
  usePlanCreationOrgPolicy.mockReturnValue(policy());
  useFindSelectedOrganizationPlanCreationTeamsByCriteria.mockReturnValue({ data: {} });
  useFindActiveOrganizationPlanCategoriesByCriteria.mockReturnValue({ data: {} });
  useFindActiveOrganizationMembersByCriteria.mockReturnValue({ data: {} });
  useGetMasterKeyConfigurationStatus.mockReturnValue({
    data: overrides.organizationKeyReady ?? true,
    loading: false,
  });
  useGetOrganizationPlanCreationStorageLayerSummary.mockReturnValue({
    data: { activeDataStorageLayerCount: overrides.storageActiveDataStorageLayerCount ?? 1 },
    loading: false,
  });
  useVerifyMasterKeyPassphrase.mockReturnValue({ verify: vi.fn().mockResolvedValue(true) });
  useGetMasterKeySeed.mockReturnValue({ data: null });
}

function stubMasterKeySessionAutoDeliver() {
  useMasterKeySession.mockImplementation(
    (options: {
      planId?: string;
      enabled: boolean;
      onDelivered?: (enc: string, key: unknown) => void;
    }) => {
      if (options.enabled) {
        queueMicrotask(() => {
          void options.onDelivered?.(`encrypted-for-${options.planId ?? 'organization'}`, {});
        });
      }
      return {
        step: options.enabled ? 'ready' : 'preparing',
        error: null,
        availableMasterKey: null,
      };
    },
  );
}

/** Fake `window.inheriti.api.request` standing in for the Electron bridge — every stage/reconcile call goes through it. */
const apiRequest = vi.fn();

function stubBridge() {
  Object.defineProperty(window, 'inheriti', {
    configurable: true,
    value: { api: { request: apiRequest } },
  });
}

/** Default: nothing is staged yet (GET -> not found), staging succeeds (POST -> 201). */
function stubImporterToolApi(
  overrides: {
    staged?: Set<string>;
    onStage?: (body: unknown) => void;
    failStage?: (planId: string, stageIndex: number) => boolean;
  } = {},
) {
  const staged = overrides.staged ?? new Set<string>();
  let stageIndex = 0;
  apiRequest.mockImplementation(
    async (request: { method: string; path: string; body?: { id: string } }) => {
      if (request.method === 'GET') {
        const id = request.path.split('/').pop()!;
        return staged.has(id)
          ? { status: 200, body: { ok: true, result: { id } } }
          : { status: 400, body: { ok: false, error: 'staged_item_not_found' } };
      }
      // POST stage
      overrides.onStage?.(request.body);
      const id = request.body!.id;
      stageIndex += 1;
      if (overrides.failStage?.(id, stageIndex)) {
        return {
          status: 400,
          body: { ok: false, error: 'staged_field_value_not_wrapped', description: 'boom' },
        };
      }
      staged.add(id);
      return {
        status: 201,
        body: { ok: true, result: { id, expiresAt: new Date().toISOString() } },
      };
    },
  );
  return staged;
}

beforeEach(() => {
  stubBridge();
});

afterEach(() => {
  vi.clearAllMocks();
});

function mountController(props: {
  plans: PlanDraft[];
  session: ImportSession;
  onSuccess: () => void;
  telemetry?: ImportTelemetrySink;
}) {
  const { result } = renderHook(() => usePlanBatchController(props));
  return {
    get current(): PlanBatchControllerState {
      return result.current;
    },
  };
}

async function executeController(controller: ReturnType<typeof mountController>) {
  await waitFor(() => expect(controller.current.organizationKey.localKeyAvailable).toBe(true));
  await act(async () => {
    controller.current.execute();
  });
}

describe('usePlanBatchController', () => {
  it('acquires the Organization Key and stages when execute is requested', async () => {
    stubBaseHooks({ localOrganizationKey: null });
    stubMasterKeySessionAutoDeliver();
    stubImporterToolApi();
    const controller = mountController({
      plans: [validPlan('plan-key-release')],
      session: session(),
      onSuccess: vi.fn(),
    });

    await waitFor(() => expect(controller.current.organizationKey.localKeyAvailable).toBe(false));
    act(() => controller.current.execute());
    await waitFor(() => expect(controller.current.result.complete).toHaveLength(1));

    expect(useMasterKeySession).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, planId: 'plan-key-release' }),
    );
    expect(apiRequest.mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(1);
  });

  it('stages without requiring an active storage layer', async () => {
    stubBaseHooks({ storageActiveDataStorageLayerCount: 0 });
    stubMasterKeySessionAutoDeliver();
    stubImporterToolApi();

    const plans = [validPlan('plan-a')];
    const controller = mountController({ plans, session: session(), onSuccess: vi.fn() });

    await executeController(controller);
    await waitFor(() => expect(controller.current.running).toBe(false));

    expect(apiRequest.mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(1);
    expect(controller.current.result.complete).toHaveLength(1);
  });

  it('stages with a UUID-compatible id while retaining the client id in controller state', async () => {
    stubBaseHooks();
    stubMasterKeySessionAutoDeliver();
    stubImporterToolApi();

    const plans = [validPlan('plan-stable-id')];
    const controller = mountController({ plans, session: session(), onSuccess: vi.fn() });

    await executeController(controller);
    await waitFor(() => expect(controller.current.running).toBe(false));

    const postCalls = apiRequest.mock.calls.filter(([r]) => r.method === 'POST');
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0]![0].body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(controller.current.result.complete.map((i) => i.planId)).toEqual(['plan-stable-id']);
  });

  it('reuses a locally loaded Organization Key across staged Plans', async () => {
    stubBaseHooks();
    stubMasterKeySessionAutoDeliver();
    stubImporterToolApi();

    const plans = [validPlan('plan-a'), validPlan('plan-b')];
    const controller = mountController({ plans, session: session(), onSuccess: vi.fn() });

    await executeController(controller);
    await waitFor(() => expect(controller.current.running).toBe(false));

    expect(controller.current.result.complete).toHaveLength(2);
    const planIdsRequested = useMasterKeySession.mock.calls
      .map((call) => (call[0] as { planId?: string }).planId)
      .filter((id): id is string => !!id);
    expect(planIdsRequested).toEqual([]);
  });

  it('never sends the plaintext field value — only a wrapped envelope', async () => {
    stubBaseHooks();
    stubMasterKeySessionAutoDeliver();
    stubImporterToolApi();

    const plans = [validPlan('plan-a')];
    const controller = mountController({ plans, session: session(), onSuccess: vi.fn() });

    await executeController(controller);
    await waitFor(() => expect(controller.current.running).toBe(false));

    const [postCall] = apiRequest.mock.calls.filter(([r]) => r.method === 'POST');
    const body = postCall![0].body as {
      assetDrafts: {
        fields: {
          fieldId: string;
          envelope: { ciphertext: string; iv: string; algorithm: string };
        }[];
      }[];
    };
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('s3cr3t');
    const field = body.assetDrafts[0]!.fields.find((f) => f.fieldId === 'secret.text');
    expect(field).toBeDefined();
    expect(field!.envelope.algorithm).toBe('AES-GCM-256');
    expect(field!.envelope.ciphertext.length).toBeGreaterThan(0);
    expect(field!.envelope.iv.length).toBeGreaterThan(0);
  });

  it('keeps a Plan that failed to stage as created-unconfigured, not lost', async () => {
    stubBaseHooks();
    stubMasterKeySessionAutoDeliver();
    stubImporterToolApi({ failStage: () => true });

    const plans = [validPlan('plan-a')];
    const onSuccess = vi.fn();
    const controller = mountController({ plans, session: session(), onSuccess });

    await executeController(controller);
    await waitFor(() => expect(controller.current.running).toBe(false));

    expect(controller.current.result.createdUnconfigured).toHaveLength(1);
    expect(controller.current.result.createdUnconfigured[0]!.status).toBe('FAILED_CONFIGURE');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('purges (calls onSuccess) only when every Plan in the batch fully stages', async () => {
    stubBaseHooks();
    stubMasterKeySessionAutoDeliver();
    stubImporterToolApi({ failStage: (_planId, stageIndex) => stageIndex === 2 });

    const onSuccessPartial = vi.fn();
    const partialPlans = [validPlan('plan-ok'), validPlan('plan-fail')];
    const partial = mountController({
      plans: partialPlans,
      session: session(),
      onSuccess: onSuccessPartial,
    });
    await executeController(partial);
    await waitFor(() => expect(partial.current.running).toBe(false));
    expect(onSuccessPartial).not.toHaveBeenCalled();

    stubImporterToolApi();
    const onSuccessFull = vi.fn();
    const fullPlans = [validPlan('plan-ok-2')];
    const full = mountController({
      plans: fullPlans,
      session: session(),
      onSuccess: onSuccessFull,
    });
    await executeController(full);
    await waitFor(() => expect(full.current.running).toBe(false));
    expect(onSuccessFull).toHaveBeenCalledTimes(1);
  });

  it('does not report success when cancellation occurs during the final stage request', async () => {
    stubBaseHooks();
    stubMasterKeySessionAutoDeliver();
    let completeStage!: (value: { status: number; body: object }) => void;
    apiRequest.mockImplementation(
      (request: { method: string; path: string; body?: { id: string } }) => {
        if (request.method === 'GET') {
          return Promise.resolve({
            status: 400,
            body: { ok: false, error: 'staged_item_not_found' },
          });
        }
        return new Promise((resolve) => {
          completeStage = resolve;
        });
      },
    );
    const onSuccess = vi.fn();
    const controller = mountController({
      plans: [validPlan('plan-cancelled')],
      session: session(),
      onSuccess,
    });

    await waitFor(() => expect(controller.current.organizationKey.localKeyAvailable).toBe(true));
    act(() => controller.current.execute());
    await waitFor(() => expect(completeStage).toBeTypeOf('function'));
    act(() => controller.current.cancel());
    await act(async () => {
      completeStage({
        status: 201,
        body: {
          ok: true,
          result: { id: 'plan-cancelled', expiresAt: new Date().toISOString() },
        },
      });
    });
    await waitFor(() => expect(controller.current.running).toBe(false));

    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('cancels the whole attempt when a multi-Plan key release is cancelled', async () => {
    stubBaseHooks({ localOrganizationKey: null });
    useMasterKeySession.mockImplementation((options: { enabled: boolean }) => ({
      step: options.enabled ? 'ready' : 'preparing',
      error: null,
      availableMasterKey: null,
    }));
    stubImporterToolApi();
    const controller = mountController({
      plans: [validPlan('plan-a'), validPlan('plan-b')],
      session: session(),
      onSuccess: vi.fn(),
    });

    await waitFor(() => expect(controller.current.organizationKey.localKeyAvailable).toBe(false));
    act(() => controller.current.execute());
    await waitFor(() => expect(controller.current.organizationKey.activePlanId).toBe('plan-a'));
    act(() => controller.current.cancelOrganizationKeyRequest());
    await waitFor(() => expect(controller.current.running).toBe(false));

    const enabledPlanIds = useMasterKeySession.mock.calls
      .filter((call) => (call[0] as { enabled: boolean }).enabled)
      .map((call) => (call[0] as { planId?: string }).planId);
    expect(enabledPlanIds).toContain('plan-a');
    expect(enabledPlanIds).not.toContain('plan-b');
    expect(apiRequest.mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(0);
  });

  it('never claims a rollback: one Plan failing does not affect another Plan’s successful outcome', async () => {
    stubBaseHooks();
    stubMasterKeySessionAutoDeliver();
    stubImporterToolApi({ failStage: (_planId, stageIndex) => stageIndex === 2 });

    const plans = [validPlan('plan-good'), validPlan('plan-bad')];
    const controller = mountController({ plans, session: session(), onSuccess: vi.fn() });

    await executeController(controller);
    await waitFor(() => expect(controller.current.running).toBe(false));

    expect(controller.current.result.complete.map((i) => i.planId)).toEqual(['plan-good']);
    expect(controller.current.result.createdUnconfigured.map((i) => i.planId)).toEqual([
      'plan-bad',
    ]);
  });

  it('reconciles against the importer-tool staged-item lookup on retryConfigure, instead of re-staging', async () => {
    stubBaseHooks();
    stubMasterKeySessionAutoDeliver();
    let stagedItemId = '';
    stubImporterToolApi({
      failStage: () => true,
      onStage: (body) => {
        stagedItemId = (body as { id: string }).id;
      },
    });

    const plans = [validPlan('plan-retry')];
    const onSuccess = vi.fn();
    const controller = mountController({ plans, session: session(), onSuccess });

    await executeController(controller);
    await waitFor(() => expect(controller.current.running).toBe(false));
    expect(controller.current.result.createdUnconfigured.map((i) => i.planId)).toEqual([
      'plan-retry',
    ]);

    // The item actually landed server-side despite the failure the client saw
    // (e.g. the response was lost); a real staged item now exists for it.
    const staged = stubImporterToolApi({ staged: new Set([stagedItemId]) });
    apiRequest.mockClear();

    await act(async () => {
      controller.current.retryConfigure('plan-retry');
    });
    await waitFor(() => expect(controller.current.running).toBe(false));

    expect(controller.current.result.complete.map((i) => i.planId)).toEqual(['plan-retry']);
    const postCallsAfterRetry = apiRequest.mock.calls.filter(([r]) => r.method === 'POST');
    // Reconciled via the GET lookup — no second stage POST for this id.
    expect(postCallsAfterRetry).toHaveLength(0);
    expect(staged.has(stagedItemId)).toBe(true);
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('completes after retrying only the failed Plan in a partial batch', async () => {
    stubBaseHooks();
    stubMasterKeySessionAutoDeliver();
    const staged = stubImporterToolApi({ failStage: (_planId, index) => index === 2 });
    const onSuccess = vi.fn();
    const controller = mountController({
      plans: [validPlan('plan-ok'), validPlan('plan-retry')],
      session: session(),
      onSuccess,
    });

    await executeController(controller);
    await waitFor(() => expect(controller.current.running).toBe(false));
    expect(controller.current.result.complete.map((item) => item.planId)).toEqual(['plan-ok']);
    expect(onSuccess).not.toHaveBeenCalled();

    stubImporterToolApi({ staged });
    apiRequest.mockClear();
    act(() => controller.current.retryConfigure('plan-retry'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());

    expect(controller.current.result.complete).toHaveLength(2);
    expect(apiRequest.mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(1);
  });

  it('records only non-sensitive telemetry (no plan name, asset, or key content)', async () => {
    stubBaseHooks();
    stubMasterKeySessionAutoDeliver();
    stubImporterToolApi();

    const events: ImportTelemetryEvent[] = [];
    const telemetry: ImportTelemetrySink = { record: (event) => events.push(event) };

    const plans = [validPlan('plan-a', 'Very Secret Plan Name')];
    const controller = mountController({
      plans,
      session: session(),
      onSuccess: vi.fn(),
      telemetry,
    });

    await executeController(controller);
    await waitFor(() => expect(controller.current.running).toBe(false));

    expect(events.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toMatch(/Very Secret Plan Name/);
    expect(serialized).not.toMatch(/s3cr3t/);
    for (const event of events) {
      expect(Object.keys(event).sort()).toEqual(
        expect.arrayContaining(['at', 'correlationId', 'name']),
      );
    }
  });
});
