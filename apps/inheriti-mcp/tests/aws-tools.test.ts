import { expect, it } from 'vitest';
import { registerTools } from '../src/tools/index.js';

it('omits automation, plan creation, and Workspace tools when disabled', () => {
  const names: string[] = [];
  const server = { registerTool: (name: string) => { names.push(name); return {}; } };
  registerTools(server as never, {} as never);
  expect(names).not.toContain('prepare_automation_ec2');
  expect(names).not.toContain('pair_aws_automation_service');
  expect(names).not.toContain('create_plan_with_assistant');
  expect(names).not.toContain('open_inheriti_file');
  expect(names).toContain('download_plan_asset');
});
