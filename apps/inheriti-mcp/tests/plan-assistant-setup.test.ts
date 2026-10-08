import { expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ status: vi.fn(), install: vi.fn(), open: vi.fn() }));
vi.mock('@safetech/inheriti-elements-core/node-base', async importOriginal => ({
  ...await importOriginal<typeof import('@safetech/inheriti-elements-core/node-base')>(),
  getLocalAssistantInstallStatus: mock.status,
  installLocalAssistant: mock.install,
}));
import { ensureLocalAssistant } from '../src/plan-assistant.js';

it('requires local consent, starts one install, and cancels its download', async () => {
  mock.status.mockResolvedValue({ installed: false, executablePath: '/runtime', modelPath: '/model' });
  let installSignal!: AbortSignal;
  let onProgress!: (progress: { phase: 'model'; downloadedBytes: number; totalBytes: number }) => void;
  mock.install.mockImplementation(({ signal, onProgress: report }: { signal: AbortSignal; onProgress: typeof onProgress }) => {
    installSignal = signal;
    onProgress = report;
    return new Promise(() => undefined);
  });
  mock.open.mockImplementation(() => undefined);
  const pending = ensureLocalAssistant(new AbortController().signal, mock.open);
  const outcome = pending.then(() => 'installed', error => (error as Error).message);
  await vi.waitFor(() => expect(mock.open).toHaveBeenCalledOnce());
  const url = mock.open.mock.calls[0]![0] as string;
  const setupResponse = await fetch(url);
  expect(setupResponse.headers.get('referrer-policy')).toBe('same-origin');
  const page = await setupResponse.text();
  const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(page)?.[1];
  expect(csrf).toBeTruthy();
  expect(page).not.toContain('private');
  const oversized = await fetch(url, { method: 'POST', headers: { origin: new URL(url).origin, 'content-type': 'application/x-www-form-urlencoded' }, body: 'x'.repeat(1025) });
  expect(oversized.status).toBe(400);
  expect(mock.install).not.toHaveBeenCalled();
  const submit = (action: string) => fetch(url, { method: 'POST', headers: { origin: new URL(url).origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf: csrf!, action }) });
  const [first, second] = await Promise.all([submit('install'), submit('install')]);
  expect([first.status, second.status].sort()).toEqual([200, 400]);
  expect(mock.install).toHaveBeenCalledOnce();
  onProgress({ phase: 'model', downloadedBytes: 50, totalBytes: 100 });
  const installing = await (await fetch(url)).text();
  expect(installing).toContain('Downloading model · 50%');
  expect(installing).toContain('value="50" max="100"');
  expect((await submit('cancel')).status).toBe(200);
  expect(await outcome).toBe('local_plan_canceled');
  expect(installSignal.aborted).toBe(true);
});

it('does not open setup after cancellation during the install-status check', async () => {
  mock.open.mockClear();
  mock.install.mockClear();
  let finishStatus!: (status: { installed: boolean; executablePath: string; modelPath: string }) => void;
  mock.status.mockImplementationOnce(() => new Promise(resolve => { finishStatus = resolve; }));
  const controller = new AbortController();
  const pending = ensureLocalAssistant(controller.signal, mock.open);
  controller.abort();
  finishStatus({ installed: false, executablePath: '/runtime', modelPath: '/model' });
  await expect(pending).rejects.toThrow('local_plan_canceled');
  expect(mock.open).not.toHaveBeenCalled();
  expect(mock.install).not.toHaveBeenCalled();
});
