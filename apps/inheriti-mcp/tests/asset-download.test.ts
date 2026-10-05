import { expect, it, vi } from 'vitest';

const { deliverAssetInBrowser, deliverInBrowser, deliverFieldsInBrowser, deliverSelectionInBrowser } = vi.hoisted(() => ({
  deliverAssetInBrowser: vi.fn().mockResolvedValue(undefined),
  deliverFieldsInBrowser: vi.fn().mockResolvedValue(undefined),
  deliverSelectionInBrowser: vi.fn().mockResolvedValue(undefined),
  deliverInBrowser: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/local-browser.js', () => ({
  deliverInBrowser,
  deliverFieldsInBrowser,
  deliverSelectionInBrowser,
  deliverAssetInBrowser,
}));
vi.mock('../src/safekey-pro.js', () => ({ openSafeKeyProPrompt: async () => ({ selectCustodianDevice: () => 'SK_MOBILE', close: () => undefined }) }));

import { MetadataTools, registerRevealTools } from '../src/server.js';

it('downloads a binary through the local page without returning bytes or a URL to MCP', async () => {
  const tools = new MetadataTools() as any;
  const bytes = Uint8Array.from([0, 255, 60, 62]);
  const exportAsset = vi.fn(async (_selector: string, destination: (asset: unknown) => Promise<void>) => {
    await destination({ id: 'file-1', fileName: 'report.pdf', mimeType: 'application/pdf', bytes });
  });
  tools.selected = async () => ({ organizationId: 'org-1', core: {
    getPlan: async () => ({ governance: { mode: 'DIRECT' } }),
    withReveal: async (_planId: string, _options: unknown, work: (reveal: unknown) => Promise<void>) => work({ exportAsset, session: { expiresAt: new Date(Date.now() + 60_000).toISOString() } }),
  } });

  const started = await tools.reveal('plan-1', 'file-1', 'ASSET');
  expect(started).toEqual(expect.objectContaining({ status: 'WAITING' }));
  await vi.waitFor(async () => expect((await tools.revealStatus(started.jobId)).status).toBe('DELIVERED'));
  expect(exportAsset).toHaveBeenCalledWith('file-1', expect.any(Function));
  expect(deliverAssetInBrowser).toHaveBeenCalledWith('report.pdf', bytes, expect.objectContaining({ signal: expect.any(AbortSignal), mimeType: 'application/pdf' }));
  expect(JSON.stringify(started)).not.toContain('report.pdf');
  expect(JSON.stringify(started)).not.toContain('[255]');
  expect(JSON.stringify(started)).not.toContain('127.0.0.1');
});

it('registers the download tool with a status-only MCP result', async () => {
  const handlers = new Map<string, (args: unknown) => Promise<unknown>>();
  const server = { registerTool: (name: string, _options: unknown, handler: (args: unknown) => Promise<unknown>) => { handlers.set(name, handler); } };
  const reveal = vi.fn().mockResolvedValue({ jobId: 'job-1', status: 'WAITING', phase: 'STARTING' });
  registerRevealTools(server as never, { reveal, revealStatus: vi.fn() } as never);
  const result = await handlers.get('download_plan_asset')!({ planId: 'plan-1', asset: 'file-1' });
  expect(reveal).toHaveBeenCalledWith('plan-1', 'file-1', 'ASSET');
  expect(result).toEqual({ content: [{ type: 'text', text: JSON.stringify({ jobId: 'job-1', status: 'WAITING', phase: 'STARTING' }) }] });
});

it('reports a named moderation denial without exposing delivered material', async () => {
  const tools = new MetadataTools() as any;
  tools.selected = async () => ({ organizationId: 'org-1', core: {
    getPlan: async () => ({ governance: { mode: 'GOVERNED' }, participants: [{ id: 'm1',
      displayName: 'Ada', lifecycle: 'ACTIVE', relationships: ['MODERATOR'] }] }),
    withReveal: async (_planId: string, options: { onProgress: (progress: unknown) => void }) => {
      options.onProgress({ phase: 'DENIED', session: { stage: 'DENIED', deniedBy: 'MODERATION',
        moderators: [{ id: 'm1', status: 'REJECTED' }] } });
      throw new Error('reveal_denied');
    },
  } });

  const started = await tools.reveal('plan-1', 'asset.field');
  await vi.waitFor(async () => expect((await tools.revealStatus(started.jobId)).status).toBe('FAILED'));
  expect(await tools.revealStatus(started.jobId)).toMatchObject({ phase: 'DENIED',
    message: 'Ada rejected the moderator approval request. Access was denied.' });
});

it.each(['FIELD', 'ASSET'] as const)('keeps %s delivery pending until local confirmation', async kind => {
  const tools = new MetadataTools() as any;
  let confirm!: () => void;
  const delivery = new Promise<void>(resolve => { confirm = resolve; });
  const deliver = kind === 'FIELD' ? deliverInBrowser : deliverAssetInBrowser;
  deliver.mockReturnValueOnce(delivery);
  tools.selected = async () => ({ organizationId: 'org-1', core: {
    getPlan: async () => ({ governance: { mode: 'DIRECT' } }),
    withReveal: async (_id: string, _options: unknown, work: (reveal: unknown) => Promise<void>) => work({
      session: { expiresAt: new Date(Date.now() + 60_000).toISOString() },
      consumeFields: async (_selectors: unknown, destination: (fields: unknown) => Promise<void>) => destination([{ value: 'private-value' }]),
      exportAsset: async (_selector: string, destination: (asset: unknown) => Promise<void>) => destination({ bytes: Uint8Array.from([255]) }),
    }),
  } });
  const started = await tools.reveal('plan-1', kind === 'FIELD' ? 'account.password' : 'file-1', kind);
  expect(started.status).toBe('WAITING');
  expect(started.instruction).toContain('check_reveal_status');
  await vi.waitFor(() => expect(deliver).toHaveBeenCalled());
  expect(await tools.revealStatus(started.jobId)).toMatchObject({ status: 'WAITING', instruction: started.instruction, message: expect.stringContaining('secure window') });
  confirm();
  await vi.waitFor(async () => expect((await tools.revealStatus(started.jobId)).status).toBe('DELIVERED'));
  expect(await tools.revealStatus(started.jobId)).not.toHaveProperty('instruction');
});

it.each(['local_window_unavailable', 'local_delivery_expired', 'local_delivery_canceled'])('reports %s from the delivery callback safely', async code => {
  const tools = new MetadataTools() as any;
  deliverAssetInBrowser.mockRejectedValueOnce(new Error(code));
  tools.selected = async () => ({ organizationId: 'org-1', core: {
    getPlan: async () => ({ governance: { mode: 'DIRECT' } }),
    withReveal: async (_id: string, _options: unknown, work: (reveal: unknown) => Promise<void>) => work({
      session: { expiresAt: new Date(Date.now() + 60_000).toISOString() },
      exportAsset: async (_selector: string, destination: (asset: unknown) => Promise<void>) => destination({ fileName: 'private-file', bytes: Uint8Array.from([255]) }),
    }),
  } });
  const started = await tools.reveal('plan-1', 'file-1', 'ASSET');
  const terminal = code === 'local_delivery_canceled' ? 'CANCELED' : 'FAILED';
  await vi.waitFor(async () => expect((await tools.revealStatus(started.jobId)).status).toBe(terminal));
  const status = await tools.revealStatus(started.jobId);
  expect(status).toMatchObject({ code, message: expect.any(String) });
  expect(status.message).not.toBe('Reveal could not continue.');
  expect(JSON.stringify(status)).not.toContain('private-file');
  expect(JSON.stringify(status)).not.toContain('[255]');
  expect(status).not.toHaveProperty('instruction');
});

it.each([false, true])('delivers deduplicated selections in one reveal (all=%s)', async all => {
  const tools = new MetadataTools() as any;
  const consumeFields = vi.fn(async (requests: Array<{ selector: string }>, destination: (fields: Array<{ value: string }>) => Promise<void>) => destination(requests.map(request => ({ value: `private-${request.selector}` }))));
  const bytes = Uint8Array.from([255]);
  const exportAsset = vi.fn(async (_selector, destination) => {
    try { await destination({ fileName: 'private.pdf', bytes }); }
    finally { bytes.fill(0); }
  });
  deliverSelectionInBrowser.mockImplementationOnce(async (_fields, assets) => {
    expect(assets[0].bytes[0]).toBe(255);
  });
  const withReveal = vi.fn(async (_id, _options, work) => work({ consumeFields, exportAsset, session: { expiresAt: new Date(Date.now() + 60_000).toISOString() } }));
  tools.selected = async () => ({ organizationId: 'org', core: {
    getPlan: async () => ({ assets: [
      { id: 'account', code: 'account', isBinary: false, fieldNames: ['password', 'username'] },
      { id: 'file', isBinary: true },
    ] }), withReveal,
  } });
  const started = await tools.revealFields('plan', all ? { all: true } : {
    selectors: ['account.password', 'account.username', 'account.password'], assets: ['file', 'file'],
  });
  await tools.job.done;
  const status = await tools.revealStatus(started.jobId);
  expect(status.status).toBe('DELIVERED');
  expect(withReveal).toHaveBeenCalledTimes(1);
  expect(consumeFields).toHaveBeenCalledTimes(1);
  expect(consumeFields.mock.calls[0]![0].map(request => request.selector)).toEqual(['account.password', 'account.username']);
  expect(exportAsset).toHaveBeenCalledTimes(1);
  expect(bytes[0]).toBe(0);
  expect(deliverSelectionInBrowser).toHaveBeenLastCalledWith([
    { selector: 'account.password', value: 'private-account.password' },
    { selector: 'account.username', value: 'private-account.username' },
  ], [{ selector: 'file', fileName: 'private.pdf', bytes: Uint8Array.from([0]) }], expect.objectContaining({ timeoutMs: expect.any(Number) }));
  expect(JSON.stringify({ started, status })).not.toMatch(/private|127\.0\.0\.1|\[255\]/);
});

it('rejects conflicting or unknown selections before approvals', async () => {
  const tools = new MetadataTools() as any;
  const withReveal = vi.fn();
  tools.selected = async () => ({ organizationId: 'org', core: {
    getPlan: async () => ({ assets: [{ id: 'account', code: 'account', fieldNames: ['password'] }] }), withReveal,
  } });
  await expect(tools.revealFields('plan', { selector: 'account.password', all: true })).rejects.toMatchObject({ code: 'asset_selector_invalid' });
  await expect(tools.revealFields('plan', { selectors: [] })).rejects.toMatchObject({ code: 'asset_selector_invalid' });
  const started = await tools.revealFields('plan', { selectors: ['account.unknown'] });
  await tools.job.done;
  expect(await tools.revealStatus(started.jobId)).toMatchObject({ status: 'FAILED', code: 'asset_field_not_found' });
  expect(withReveal).not.toHaveBeenCalled();
});


it('does not open local delivery after the reveal grant expires', async () => {
  const tools = new MetadataTools() as any;
  const deliveryCalls = deliverFieldsInBrowser.mock.calls.length;
  tools.selected = async () => ({ organizationId: 'org', core: {
    getPlan: async () => ({ assets: [{ id: 'account', fieldNames: ['password'] }] }),
    withReveal: async (_id: string, _options: unknown, work: (reveal: unknown) => Promise<void>) => work({
      session: { expiresAt: new Date(Date.now() - 1).toISOString() },
      consumeFields: async (_requests: unknown, destination: (fields: unknown) => Promise<void>) => destination([{ value: 'private' }]),
    }),
  } });
  const started = await tools.revealFields('plan', { all: true });
  await tools.job.done;
  expect(await tools.revealStatus(started.jobId)).toMatchObject({ status: 'FAILED', code: 'local_delivery_expired' });
  expect(deliverFieldsInBrowser.mock.calls.length).toBe(deliveryCalls);
});
