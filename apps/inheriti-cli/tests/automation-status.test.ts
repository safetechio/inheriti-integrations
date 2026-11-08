import { expect, it, vi } from 'vitest';
const id = '00000000-0000-4000-8000-000000000001';
const reveal = '00000000-0000-4000-8000-000000000003';
const relay = '00000000-0000-4000-8000-000000000004';
const connection = '00000000-0000-4000-8000-000000000002';
const { read, listPlans, listConnections } = vi.hoisted(() => ({ read: vi.fn(), listPlans: vi.fn(), listConnections: vi.fn() }));
vi.mock('@safetech/inheriti-elements-core/node-base', async original => ({ ...(await original<object>()),
  createAutomationStatusReader: () => read,
  createAutomationSetupOperations: () => ({ listPlans, listConnections }),
}));
import { automationStatus } from '../src/commands/automation-status.js';
const snapshot = { observedAt: '2026-11-04T12:00:00.000Z', provider: 'GITHUB', connectionId: connection, planId: id, providerStatus: 'UNVERIFIED',
  setup: { status: 'READY', steps: [{ code: 'CONNECTION', state: 'COMPLETE' }, { code: 'IDENTITY', state: 'COMPLETE' }, { code: 'PLAN_ACCESS', state: 'COMPLETE' }, { code: 'READY', state: 'COMPLETE' }], nextAction: null },
  executions: { items: [{ jobId: id, revealId: reveal, relayId: relay, runReference: 'https://github.com/acme/repo/actions/runs/1', stage: 'WAITING_FOR_ORGANISATION_KEY', status: 'IN_PROGRESS', nextAction: { code: 'RELEASE_ORGANISATION_KEY', actor: 'RESPONSIBLE_MEMBER', responsibleMemberId: id } }, { jobId: id, relayId: connection, stage: 'ORGANISATION_KEY_DELIVERED', status: 'DELIVERED', nextAction: null }], hasMore: false } };
const context = { organization: { id }, core: { getAccessToken: async () => 'token' } };
const configuration = { apiUrl: 'http://localhost:3400/integrations/' };
const terminal = () => ({ interactive: false, stdoutIsTTY: false, columns: 80, write: vi.fn(), writeError: vi.fn() });

it('requires explicit IDs in a pipe and renders only safe status', async () => {
  read.mockResolvedValue(snapshot);
  const output = terminal();
  expect(await automationStatus(context as never, configuration as never, output, [], new AbortController().signal)).toBe(1);
  expect(read).not.toHaveBeenCalled();
  expect(await automationStatus(context as never, configuration as never, output, ['--plan', id, '--connection', connection], new AbortController().signal)).toBe(0);
  expect(read).toHaveBeenCalledWith(id, connection, undefined, expect.any(AbortSignal));
  const printed = output.write.mock.calls.flat().join('\n');
  expect(printed).toContain('Provider run status: unverified.');
  expect(printed).toContain(`Reveal ${reveal}`);
  expect(printed).toContain(`Relay ${relay}`);
  expect(printed).toContain(`member ${id}`);
  expect(printed).toContain('Run https://github.com/acme/repo/actions/runs/1');
  expect(printed).toContain('Organisation key delivered; automation outcome unverified');
});

it('watch polls read-only until cancellation', async () => {
  vi.useFakeTimers();
  try {
    read.mockResolvedValue(snapshot);
    read.mockClear();
    const output = terminal();
    const controller = new AbortController();
    const run = automationStatus(context as never, configuration as never, output, ['--plan', id, '--connection', connection, '--watch', '--json'], controller.signal);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(5000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(output.write.mock.calls).toHaveLength(2);
    expect(output.write.mock.calls.every(([line]) => !String(line).includes('\n') && JSON.parse(String(line)).providerStatus === 'UNVERIFIED')).toBe(true);
    controller.abort();
    expect(await run).toBe(0);
    expect(read).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});

it('stops a pending read cleanly when cancelled', async () => {
  read.mockClear();
  read.mockImplementationOnce((_plan, _connection, _job, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })));
  const controller = new AbortController();
  const output = terminal();
  const run = automationStatus(context as never, configuration as never, output, ['--plan', id, '--connection', connection, '--watch'], controller.signal);
  await vi.waitFor(() => expect(read).toHaveBeenCalled());
  controller.abort();
  expect(await run).toBe(0);
  expect(output.write).not.toHaveBeenCalled();
});
