import { beforeEach, expect, it, vi } from 'vitest';

const id = 'e4917865-d02f-4b1a-9efb-54782aa76d23';
const role = 'arn:aws:iam::123456789012:role/app';
const mock = vi.hoisted(() => ({
  getConnection: vi.fn(),
  startPairing: vi.fn(),
  inspectEc2AutomationInstance: vi.fn(),
  pairEc2Automation: vi.fn(),
  promptSelect: vi.fn(),
}));
vi.mock('@safetech/inheriti-elements-core/node-base', async original => ({
  ...(await original<object>()),
  createAutomationSetupOperations: () => mock,
  inspectEc2AutomationInstance: mock.inspectEc2AutomationInstance,
  pairEc2Automation: mock.pairEc2Automation,
}));
vi.mock('../src/render/select.js', () => ({ promptSelect: mock.promptSelect }));

import { pairEc2AutomationInstance } from '../src/commands/automation-pair-ec2.js';

const context = { organization: { id: 'org-1' }, core: { getAccessToken: vi.fn(async () => 'token') } };
const configuration = { apiUrl: 'http://business.localhost:3400/integrations/' };
const terminal = (interactive: boolean) => ({ interactive, stdoutIsTTY: interactive, columns: 100, write: vi.fn(), writeError: vi.fn() });
const argv = ['--connection', id, '--region', 'us-east-1', '--instance', 'i-09ce8440ae7294ab9'];

beforeEach(() => {
  vi.clearAllMocks();
  mock.getConnection.mockResolvedValue({ id, provider: 'AWS', status: 'PENDING_VERIFICATION', trust: { method: 'AWS_IAM_ROLE', roleArn: role } });
  mock.inspectEc2AutomationInstance.mockResolvedValue({ region: 'us-east-1', instanceId: 'i-09ce8440ae7294ab9', roleArn: role });
  mock.pairEc2Automation.mockResolvedValue({ commandId: id, status: 'paired' });
  mock.promptSelect.mockResolvedValue('run');
});

it('confirms the attached role and pairs once, then checks Business verification', async () => {
  mock.getConnection.mockResolvedValueOnce({ id, provider: 'AWS', status: 'PENDING_VERIFICATION', trust: { method: 'AWS_IAM_ROLE', roleArn: role } })
    .mockResolvedValueOnce({ id, provider: 'AWS', status: 'VERIFIED', trust: { method: 'AWS_IAM_ROLE', roleArn: role } });
  const output = terminal(true);
  expect(await pairEc2AutomationInstance(context as never, configuration as never, output as never, argv)).toBe(0);
  expect(mock.promptSelect).toHaveBeenCalledOnce();
  expect(mock.pairEc2Automation).toHaveBeenCalledOnce();
  const displayed = output.write.mock.calls.flat().join('\n');
  expect(displayed).toContain('EC2 instance to pair');
  expect(displayed).toContain(role);
  expect(displayed).toContain('EC2 connection verified');
  expect(displayed).toContain('SSM command');
  expect(displayed).not.toContain('"instanceId"');
});

it('keeps JSON for noninteractive callers that pin the expected role', async () => {
  mock.getConnection.mockResolvedValueOnce({ id, provider: 'AWS', status: 'PENDING_VERIFICATION', trust: { method: 'AWS_IAM_ROLE', roleArn: role } })
    .mockResolvedValueOnce({ id, provider: 'AWS', status: 'VERIFIED', trust: { method: 'AWS_IAM_ROLE', roleArn: role } });
  const output = terminal(false);
  expect(await pairEc2AutomationInstance(context as never, configuration as never, output as never,
    [...argv, '--expect-role', role])).toBe(0);
  expect(JSON.parse(output.write.mock.calls[0]![0])).toMatchObject({ connectionId: id, connectionStatus: 'VERIFIED' });
  expect(mock.promptSelect).not.toHaveBeenCalled();
});

it('stops before opening the pairing window when the role differs or confirmation is declined', async () => {
  mock.inspectEc2AutomationInstance.mockResolvedValueOnce({ region: 'us-east-1', instanceId: 'i-09ce8440ae7294ab9', roleArn: 'arn:aws:iam::123456789012:role/other' });
  expect(await pairEc2AutomationInstance(context as never, configuration as never, terminal(true) as never, argv)).toBe(1);
  expect(mock.pairEc2Automation).not.toHaveBeenCalled();
  mock.promptSelect.mockResolvedValueOnce('cancel');
  expect(await pairEc2AutomationInstance(context as never, configuration as never, terminal(true) as never, argv)).toBe(1);
  expect(mock.pairEc2Automation).not.toHaveBeenCalled();
});

it('requires a pinned role for noninteractive use', async () => {
  const output = terminal(false);
  expect(await pairEc2AutomationInstance(context as never, configuration as never, output as never, argv)).toBe(1);
  expect(mock.getConnection).not.toHaveBeenCalled();
  expect(output.writeError.mock.calls.flat().join(' ')).toContain('--expect-role');
});
