import { expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  createContext: vi.fn(), acquireKey: vi.fn(), createMany: vi.fn(), runBrowser: vi.fn(),
  nativeClose: vi.fn(), nativeSession: { open: vi.fn(), close: vi.fn(), complete: vi.fn() },
}));
vi.mock('@safetech/inheriti-elements-core/node-base', async importOriginal => ({
  ...await importOriginal<typeof import('@safetech/inheriti-elements-core/node-base')>(),
  createQuickPlanOperations: () => ({
    teams: async () => ({ teams: [] }), createContext: mock.createContext,
    acquireKey: mock.acquireKey, createMany: mock.createMany, abandon: vi.fn(),
  }),
  runLocalPlanBrowser: mock.runBrowser,
  createNativeWindowSession: (onClose: (reason: 'closed' | 'unavailable') => void) => {
    mock.nativeClose.mockImplementation(onClose);
    return mock.nativeSession;
  },
  LlamaPlanModel: class { stop() {} },
}));
vi.mock('../src/plan-assistant.js', () => ({ ensureLocalAssistant: async () => ({ executablePath: '/runtime', modelPath: '/model' }) }));

import { MetadataTools } from '../src/server.js';

it('reuses the plan context and master key source when browser creation is retried', async () => {
  const tools = new MetadataTools() as any;
  tools.config = { apiUrl: 'https://example.test', environment: 'TEST' };
  tools.selected = async () => ({ organizationId: 'org', core: { getAccessToken: async () => 'token' } });
  const input = { title: 'Plan', assets: [{ type: 'PLAIN-TEXT', meta: { name: 'Note' }, secret: { text: 'private' } }] };
  mock.createContext.mockResolvedValue({ planId: 'plan', storage: { activeDataStorageLayerCount: 1 } });
  mock.acquireKey.mockResolvedValue('key');
  mock.createMany.mockRejectedValueOnce(new Error('distribution failed')).mockResolvedValueOnce({ planId: 'plan', status: 'READY' });
  mock.runBrowser.mockImplementation(async ({ create }: { create: (value: typeof input) => Promise<{ planId: string; status: 'READY' | 'PENDING' }> }) => {
    await expect(create(input)).rejects.toThrow('distribution failed');
    return create(input);
  });
  const hints = { title: 'Plan', description: 'Recovery', assetTypes: ['PLAIN-TEXT'] };
  const { jobId } = await tools.createPlanWithAssistant(hints);
  await vi.waitFor(async () => expect((await tools.planCreationStatus(jobId)).status).toBe('CREATED'));
  expect(mock.createContext).toHaveBeenCalledOnce();
  expect(mock.runBrowser.mock.calls[0]![0].hints).toEqual(hints);
  expect(mock.acquireKey).toHaveBeenCalledOnce();
  expect(mock.createMany).toHaveBeenCalledTimes(2);
  expect(mock.createMany.mock.calls[0]![0].context).toBe(mock.createMany.mock.calls[1]![0].context);
  expect(mock.createMany.mock.calls[0]![0].masterKeySource).toBe(mock.createMany.mock.calls[1]![0].masterKeySource);
  expect(await tools.planCreationStatus(jobId)).toEqual({ jobId, status: 'CREATED', phase: 'COMPLETE', planId: 'plan' });
});

it('cancels plan creation when the native window closes', async () => {
  mock.runBrowser.mockReset().mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('local_plan_canceled')), { once: true });
  }));
  mock.nativeSession.close.mockClear();
  const tools = new MetadataTools() as any;
  tools.config = { apiUrl: 'https://example.test', environment: 'TEST' };
  tools.selected = async () => ({ organizationId: 'org', core: { getAccessToken: async () => 'token' } });
  const { jobId } = await tools.createPlanWithAssistant();
  await vi.waitFor(() => expect(mock.runBrowser).toHaveBeenCalledOnce());
  mock.nativeClose('closed');
  await vi.waitFor(async () => expect((await tools.planCreationStatus(jobId)).status).toBe('CANCELED'));
  expect(mock.nativeSession.close).toHaveBeenCalledOnce();
});

it('waits for an in-flight create before reporting cancellation', async () => {
  mock.createContext.mockReset().mockResolvedValue({ planId: 'plan-2', storage: { activeDataStorageLayerCount: 1 } });
  mock.acquireKey.mockReset().mockResolvedValue('key');
  let finishCreate!: (value: { planId: string; status: 'READY' }) => void;
  mock.createMany.mockReset().mockImplementation(() => new Promise(resolve => { finishCreate = resolve; }));
  mock.runBrowser.mockReset().mockImplementation(({ create, signal }: { create: (value: unknown) => Promise<{ planId: string; status: 'READY' | 'PENDING' }>; signal: AbortSignal }) => new Promise((resolve, reject) => {
    void create({ title: 'Plan', assets: [{ type: 'PLAIN-TEXT', meta: { name: 'Note' }, secret: { text: 'private' } }] }).then(resolve, reject);
    signal.addEventListener('abort', () => reject(new Error('local_plan_canceled')), { once: true });
  }));
  const tools = new MetadataTools() as any;
  tools.config = { apiUrl: 'https://example.test', environment: 'TEST' };
  tools.selected = async () => ({ organizationId: 'org', core: { getAccessToken: async () => 'token' } });
  const { jobId } = await tools.createPlanWithAssistant();
  await vi.waitFor(() => expect(mock.createMany).toHaveBeenCalledOnce());
  const cancellation = tools.planCreationStatus(jobId, true);
  finishCreate({ planId: 'plan-2', status: 'READY' });
  expect(await cancellation).toEqual({ jobId, status: 'CREATED', phase: 'COMPLETE', planId: 'plan-2' });
});
