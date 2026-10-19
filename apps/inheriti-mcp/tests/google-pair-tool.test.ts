import { expect, it, vi } from 'vitest';
import { registerPairGoogleCloudRun } from '../src/tools/pair_google_cloud_run.js';

it('requires a reviewed service revision and forwards Google pairing details', async () => {
  const registerTool = vi.fn();
  const pairGoogleAutomationService = vi.fn(async () => ({ status: 'paired' }));
  registerPairGoogleCloudRun({ registerTool } as never, { pairGoogleAutomationService } as never);
  const [name, definition, handler] = registerTool.mock.calls[0]!;
  const input = {
    connectionId: '485384e3-b685-4142-b1ca-95a0b90e56bb',
    project: 'cloud-project', region: 'us-central1', service: 'worker', expectedRevision: '42',
  };
  expect(name).toBe('pair_google_cloud_run');
  expect(definition.inputSchema.safeParse(input).success).toBe(true);
  expect(definition.inputSchema.safeParse({ ...input, expectedRevision: '' }).success).toBe(false);
  await handler(input);
  expect(pairGoogleAutomationService).toHaveBeenCalledWith(input);
});
