import { expect, it, vi } from 'vitest';
import { registerTools } from '../src/tools/index.js';

type Registered = { schema: { inputSchema: { safeParse: (input: unknown) => { success: boolean } } }; handler: (input: unknown) => Promise<unknown> };

function register() {
  const registered = new Map<string, Registered>();
  const server = { registerTool: (name: string, schema: Registered['schema'], handler: Registered['handler']) => {
    registered.set(name, { schema, handler });
    return {};
  } };
  const tools = {
    prepareAutomationEc2: vi.fn(async (input: unknown) => ({ organizationId: 'org-1', applied: false, input })),
    pairAwsAutomationService: vi.fn(async (input: unknown) => ({ organizationId: 'org-1', input })),
  };
  registerTools(server as never, tools as never);
  return { registered, tools };
}

it('registers AWS EC2 inspection, preparation and pairing tools', () => {
  const { registered } = register();
  expect(registered.has('inspect_automation_ec2_identity')).toBe(true);
  expect(registered.has('prepare_automation_ec2')).toBe(true);
  expect(registered.has('pair_aws_automation_service')).toBe(true);
});

it('validates the EC2 preparation schema and forwards the complete workload command', async () => {
  const { registered, tools } = register();
  const input = {
    planId: '485384e3-b685-4142-b1ca-95a0b90e56ba', connectionId: '485384e3-b685-4142-b1ca-95a0b90e56bb',
    region: 'us-east-1', instanceId: 'i-123', serviceName: 'worker', runAsUser: 'ubuntu',
    applicationCommand: ['/usr/bin/node', 'server.js'], mappings: [{ selector: 'asset.password', envName: 'APP_SECRET' }],
  };
  const registration = registered.get('prepare_automation_ec2')!;
  expect(registration.schema.inputSchema.safeParse(input).success).toBe(true);
  expect(registration.schema.inputSchema.safeParse({ ...input, applicationCommand: [] }).success).toBe(false);
  const result = await registration.handler(input);
  expect(tools.prepareAutomationEc2).toHaveBeenCalledWith(expect.objectContaining(input));
  expect(JSON.parse((result as { content: [{ text: string }] }).content[0].text)).toMatchObject({ applied: false });
});

it('validates the ECS pairing schema and keeps the immutable revision required', async () => {
  const { registered, tools } = register();
  const input = {
    connectionId: '485384e3-b685-4142-b1ca-95a0b90e56bb', region: 'us-east-1', cluster: 'jobs', service: 'worker',
    image: 'repo@sha256:' + 'a'.repeat(64), expectedRevision: 'arn:aws:ecs:us-east-1:123:task-definition/worker:1',
  };
  const registration = registered.get('pair_aws_automation_service')!;
  expect(registration.schema.inputSchema.safeParse(input).success).toBe(true);
  expect(registration.schema.inputSchema.safeParse({ ...input, expectedRevision: '' }).success).toBe(false);
  await registration.handler(input);
  expect(tools.pairAwsAutomationService).toHaveBeenCalledWith(expect.objectContaining(input));
});
