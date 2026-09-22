import { expect, it, vi } from 'vitest';

const { deliverAssetInBrowser } = vi.hoisted(() => ({ deliverAssetInBrowser: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/local-browser.js', () => ({
  deliverInBrowser: vi.fn(),
  deliverAssetInBrowser,
}));

import { MetadataTools, registerRevealTools } from '../src/server.js';

it('downloads a binary through the local page without returning bytes or a URL to MCP', async () => {
  const tools = new MetadataTools() as any;
  const bytes = Uint8Array.from([0, 255, 60, 62]);
  const exportAsset = vi.fn(async (_selector: string, destination: (asset: unknown) => Promise<void>) => {
    await destination({ id: 'file-1', fileName: 'report.pdf', mimeType: 'application/pdf', bytes });
  });
  tools.selected = async () => ({ organizationId: 'org-1', core: {
    getPlan: async () => ({ governance: { mode: 'DIRECT' } }),
    withReveal: async (_planId: string, _options: unknown, work: (reveal: unknown) => Promise<void>) => work({ exportAsset }),
  } });

  const started = await tools.reveal('plan-1', 'file-1', 'ASSET');
  expect(started).toEqual(expect.objectContaining({ status: 'WAITING' }));
  await vi.waitFor(async () => expect((await tools.revealStatus(started.jobId)).status).toBe('DELIVERED'));
  expect(exportAsset).toHaveBeenCalledWith('file-1', expect.any(Function));
  expect(deliverAssetInBrowser).toHaveBeenCalledWith('report.pdf', bytes, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(JSON.stringify(started)).not.toContain('report.pdf');
  expect(JSON.stringify(started)).not.toContain('255');
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
