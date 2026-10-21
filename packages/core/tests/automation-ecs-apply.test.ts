import { describe, expect, it, vi } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import { applyEcsAutomation } from '../src/automation-ecs-apply.js';
import type { EcsApplyInput, EcsApplyRunner } from '../src/automation-ecs-apply.js';

const oldRevision = 'arn:aws:ecs:us-east-1:123456789012:task-definition/app:3';
const newRevision = 'arn:aws:ecs:us-east-1:123456789012:task-definition/app:4';
const image = `example@sha256:${'a'.repeat(64)}`;
const input: EcsApplyInput = {
  target: { provider: 'AWS', region: 'us-east-1', cluster: 'cluster', service: 'service' },
  expectedRevision: oldRevision,
  expectedRoleArn: 'arn:aws:iam::123456789012:role/app',
  planId: 'ded53fde-a946-4f69-886e-f52dddf1bc5e',
  selector: 'A1.username', envName: 'APP_USERNAME', image, cliPath: '/opt/inheriti/bin/inheriti',
  environment: { INHERITI_AUTOMATION_PROVIDER: 'AWS' },
};
const service = { services: [{ status: 'ACTIVE', deploymentController: { type: 'ECS' }, taskDefinition: oldRevision }], failures: [] };
const deployedService = { services: [{ ...service.services[0], taskDefinition: newRevision, desiredCount: 1, runningCount: 1, pendingCount: 0,
  deployments: [{ taskDefinition: newRevision, status: 'PRIMARY', rolloutState: 'COMPLETED' }] }], failures: [] };
const definition = { taskDefinition: {
  taskDefinitionArn: oldRevision, family: 'app', taskRoleArn: input.expectedRoleArn, networkMode: 'awsvpc',
  containerDefinitions: [{ name: 'app', image: 'example:old', entryPoint: ['/bin/server'], command: ['--serve'],
    environment: [{ name: 'EXISTING', value: 'private-value' }], secrets: [{ name: 'NATIVE', valueFrom: 'arn:secret' }] }],
}, tags: [{ key: 'owner', value: 'test' }] };

describe('ECS automation apply', () => {
  it('passes several plan fields to the child process and rejects duplicate names', async () => {
    const registration = vi.fn();
    let descriptions = 0;
    const runner: EcsApplyRunner = async args => {
      if (args[1] === 'describe-services') return JSON.stringify(++descriptions <= 2 ? service : deployedService);
      if (args[1] === 'describe-task-definition') return JSON.stringify(definition);
      if (args[1] === 'register-task-definition') {
        const file = args[args.indexOf('--cli-input-json') + 1]!.slice(7);
        registration(JSON.parse(await readFile(file, 'utf8')).containerDefinitions[0].entryPoint);
        return JSON.stringify({ taskDefinition: { taskDefinitionArn: newRevision } });
      }
      return '{}';
    };
    const mappings = [{ envName: 'APP_USERNAME', selector: 'A1.username' },
      { envName: 'APP_PASSWORD', selector: 'A1.password' }];
    await expect(applyEcsAutomation({ ...input, mappings }, runner)).resolves.toMatchObject({ status: 'deployed' });
    expect(registration).toHaveBeenCalledWith([input.cliPath, 'secrets', 'exec', input.planId,
      '--automation', '--env', 'APP_USERNAME=A1.username', '--env', 'APP_PASSWORD=A1.password', '--', '/bin/server']);
    await expect(applyEcsAutomation({ ...input, mappings: [mappings[0]!, mappings[0]!] }, runner))
      .rejects.toThrow('automation_ecs_input_invalid');
  });
  it('registers a preserved definition through a restricted file and deploys it', async () => {
    const calls: string[][] = [];
    const runner: EcsApplyRunner = async args => {
      calls.push(args);
      if (args[1] === 'describe-services') return JSON.stringify(calls.filter(call => call[1] === 'describe-services').length <= 2 ? service : deployedService);
      if (args[1] === 'describe-task-definition') return JSON.stringify(definition);
      if (args[1] === 'register-task-definition') {
        const file = args[args.indexOf('--cli-input-json') + 1]!.slice(7);
        expect((await stat(file)).mode & 0o777).toBe(0o600);
        const body = JSON.parse(await readFile(file, 'utf8'));
        expect(body.tags).toEqual(definition.tags);
        expect(body.containerDefinitions[0].secrets).toEqual(definition.taskDefinition.containerDefinitions[0]!.secrets);
        expect(body.containerDefinitions[0].environment).toContainEqual({ name: 'EXISTING', value: 'private-value' });
        expect(body.containerDefinitions[0].entryPoint).toEqual([
          input.cliPath, 'secrets', 'exec', input.planId, '--automation', '--env', 'APP_USERNAME=A1.username', '--', '/bin/server',
        ]);
        expect(body.containerDefinitions[0].command).toEqual(['--serve']);
        return JSON.stringify({ taskDefinition: { taskDefinitionArn: newRevision } });
      }
      if (args[1] === 'update-service') return '{}';
      return '';
    };
    const result = await applyEcsAutomation(input, runner);
    expect(result).toEqual({ previousRevision: oldRevision, revision: newRevision, image, status: 'deployed' });
    expect(calls.map(args => args[1])).toEqual(['describe-services', 'describe-task-definition', 'register-task-definition', 'describe-services', 'update-service', 'wait', 'describe-services']);
    expect(JSON.stringify(result)).not.toContain('private-value');
  });

  it('accepts a stable ECS service without circuit-breaker rolloutState', async () => {
    const noCircuitBreaker = { ...deployedService, services: [{ ...deployedService.services[0], deployments: [
      { taskDefinition: newRevision, status: 'PRIMARY' },
    ] }] };
    const calls: string[][] = [];
    const runner: EcsApplyRunner = async args => {
      calls.push(args);
      if (args[1] === 'describe-services') return JSON.stringify(calls.filter(call => call[1] === 'describe-services').length <= 2 ? service : noCircuitBreaker);
      if (args[1] === 'describe-task-definition') return JSON.stringify(definition);
      if (args[1] === 'register-task-definition') return JSON.stringify({ taskDefinition: { taskDefinitionArn: newRevision } });
      return '{}';
    };
    await expect(applyEcsAutomation(input, runner)).resolves.toMatchObject({ status: 'deployed', revision: newRevision });
  });

  it('keeps a configured task unchanged for the same image and redeploys a new digest without another wrapper', async () => {
    const wrapped = {
      ...definition,
      taskDefinition: {
        ...definition.taskDefinition,
        containerDefinitions: [{
          ...definition.taskDefinition.containerDefinitions[0],
          image,
          entryPoint: [input.cliPath, 'secrets', 'exec', input.planId, '--automation', '--env',
            'APP_USERNAME=A1.username', '--', '/bin/server'],
          environment: [
            ...definition.taskDefinition.containerDefinitions[0]!.environment,
            { name: 'INHERITI_AUTOMATION_PROVIDER', value: 'AWS' },
          ],
        }],
      },
    };
    const run = vi.fn<EcsApplyRunner>(async args => args[1] === 'describe-services'
      ? JSON.stringify(service) : JSON.stringify(wrapped));
    await expect(applyEcsAutomation(input, run)).resolves.toMatchObject({ status: 'unchanged', revision: oldRevision });
    expect(run).toHaveBeenCalledTimes(2);
    const conflicting = { ...wrapped, taskDefinition: { ...wrapped.taskDefinition,
      containerDefinitions: [{ ...wrapped.taskDefinition.containerDefinitions[0],
        entryPoint: [input.cliPath, 'secrets', 'exec', input.planId, '--automation', '--env',
          'APP_USERNAME=A1.password', '--', '/bin/server'] }] } };
    const conflictRun = vi.fn<EcsApplyRunner>(async args => args[1] === 'describe-services'
      ? JSON.stringify(service) : JSON.stringify(conflicting));
    await expect(applyEcsAutomation({ ...input, image: `example@sha256:${'b'.repeat(64)}` }, conflictRun))
      .rejects.toThrow('automation_ecs_existing_setup_conflict');
    expect(conflictRun).toHaveBeenCalledTimes(2);

    const calls: string[][] = [];
    const nextImage = `example@sha256:${'b'.repeat(64)}`;
    const redeploy: EcsApplyRunner = async args => {
      calls.push(args);
      if (args[1] === 'describe-services') return JSON.stringify(calls.filter(call => call[1] === 'describe-services').length <= 2 ? service : deployedService);
      if (args[1] === 'describe-task-definition') return JSON.stringify(wrapped);
      if (args[1] === 'register-task-definition') {
        const file = args[args.indexOf('--cli-input-json') + 1]!.slice(7);
        const container = JSON.parse(await readFile(file, 'utf8')).containerDefinitions[0];
        expect(container.image).toBe(nextImage);
        expect(container.entryPoint).toEqual(wrapped.taskDefinition.containerDefinitions[0]!.entryPoint);
        expect(container.entryPoint.filter((part: string) => part === 'secrets')).toHaveLength(1);
        return JSON.stringify({ taskDefinition: { taskDefinitionArn: newRevision } });
      }
      return '{}';
    };
    await expect(applyEcsAutomation({ ...input, image: nextImage }, redeploy)).resolves.toEqual({
      previousRevision: oldRevision, revision: newRevision, image: nextImage, status: 'deployed',
    });
    expect(calls.filter(args => args[1] === 'update-service').map(args => args[args.indexOf('--task-definition') + 1]))
      .toEqual([newRevision]);
  });

  it('rolls the service back when stabilization fails', async () => {
    const calls: string[][] = [];
    const runner: EcsApplyRunner = async args => {
      calls.push(args);
      if (args[1] === 'describe-services') {
        const count = calls.filter(call => call[1] === 'describe-services').length;
        return JSON.stringify(count <= 2 ? service : count === 3 ? deployedService : {
          ...deployedService, services: [{ ...deployedService.services[0], taskDefinition: oldRevision,
            deployments: [{ taskDefinition: oldRevision, status: 'PRIMARY', rolloutState: 'COMPLETED' }] }],
        });
      }
      if (args[1] === 'describe-task-definition') return JSON.stringify(definition);
      if (args[1] === 'register-task-definition') return JSON.stringify({ taskDefinition: { taskDefinitionArn: newRevision } });
      if (args[1] === 'wait' && calls.filter(call => call[1] === 'wait').length === 1) throw new Error('sensitive provider text');
      return '{}';
    };
    await expect(applyEcsAutomation(input, runner)).rejects.toThrow('automation_ecs_deployment_failed');
    expect(calls.filter(args => args[1] === 'update-service').map(args => args[args.indexOf('--task-definition') + 1]))
      .toEqual([newRevision, oldRevision]);
  });

  it('rejects a native secret that would conflict with added automation environment', async () => {
    const run = vi.fn<EcsApplyRunner>(async args => args[1] === 'describe-services' ? JSON.stringify(service)
      : JSON.stringify({ ...definition, taskDefinition: { ...definition.taskDefinition,
        containerDefinitions: [{ ...definition.taskDefinition.containerDefinitions[0],
          secrets: [{ name: 'INHERITI_AUTOMATION_PROVIDER', valueFrom: 'arn:secret' }] }] } }));
    await expect(applyEcsAutomation(input, run)).rejects.toThrow('automation_ecs_environment_conflict');
    expect(run.mock.calls.some(([args]) => args[1] === 'register-task-definition')).toBe(false);
  });

  it('reports when a rollback waiter succeeds but the old revision is not restored', async () => {
    const calls: string[][] = [];
    const runner: EcsApplyRunner = async args => {
      calls.push(args);
      if (args[1] === 'describe-services') return JSON.stringify(calls.filter(call => call[1] === 'describe-services').length <= 2
        ? service : deployedService);
      if (args[1] === 'describe-task-definition') return JSON.stringify(definition);
      if (args[1] === 'register-task-definition') return JSON.stringify({ taskDefinition: { taskDefinitionArn: newRevision } });
      if (args[1] === 'wait' && calls.filter(call => call[1] === 'wait').length === 1) throw new Error('provider failure');
      return '{}';
    };
    await expect(applyEcsAutomation(input, runner)).rejects.toThrow('automation_ecs_rollback_unconfirmed');
  });

  it('rejects a waiter success after ECS rolls back the revision', async () => {
    const calls: string[][] = [];
    const runner: EcsApplyRunner = async args => {
      calls.push(args);
      if (args[1] === 'describe-services') return JSON.stringify(service);
      if (args[1] === 'describe-task-definition') return JSON.stringify(definition);
      if (args[1] === 'register-task-definition') return JSON.stringify({ taskDefinition: { taskDefinitionArn: newRevision } });
      return '{}';
    };
    await expect(applyEcsAutomation(input, runner)).rejects.toThrow('automation_ecs_deployment_failed');
    expect(calls.filter(args => args[1] === 'update-service')).toHaveLength(1);
  });

  it('does not overwrite an unrelated concurrent deployment during rollback', async () => {
    const calls: string[][] = [];
    const unrelated = { ...service, services: [{ ...service.services[0], taskDefinition: `${oldRevision.slice(0, -1)}5` }] };
    const runner: EcsApplyRunner = async args => {
      calls.push(args);
      if (args[1] === 'describe-services') return JSON.stringify(calls.filter(call => call[1] === 'describe-services').length <= 2 ? service : unrelated);
      if (args[1] === 'describe-task-definition') return JSON.stringify(definition);
      if (args[1] === 'register-task-definition') return JSON.stringify({ taskDefinition: { taskDefinitionArn: newRevision } });
      if (args[1] === 'wait') throw new Error('sensitive provider text');
      return '{}';
    };
    await expect(applyEcsAutomation(input, runner)).rejects.toThrow('automation_ecs_revision_changed');
    expect(calls.filter(args => args[1] === 'update-service')).toHaveLength(1);
  });

  it('stops if service revision changes after registration and before update', async () => {
    const calls: string[][] = [];
    const runner: EcsApplyRunner = async args => {
      calls.push(args);
      if (args[1] === 'describe-services') return JSON.stringify(calls.filter(call => call[1] === 'describe-services').length === 1
        ? service : deployedService);
      if (args[1] === 'describe-task-definition') return JSON.stringify(definition);
      if (args[1] === 'register-task-definition') return JSON.stringify({ taskDefinition: { taskDefinitionArn: newRevision } });
      return '{}';
    };
    await expect(applyEcsAutomation(input, runner)).rejects.toThrow('automation_ecs_revision_changed');
    expect(calls.some(args => args[1] === 'update-service')).toBe(false);
  });

  it('refuses changed revisions, mutable images and ambiguous startup', async () => {
    const run = vi.fn<EcsApplyRunner>().mockResolvedValue('{}');
    await expect(applyEcsAutomation({ ...input, image: 'example:latest' }, run)).rejects.toThrow('automation_ecs_input_invalid');
    expect(run).not.toHaveBeenCalled();
    const changed: EcsApplyRunner = async args => args[1] === 'describe-services'
      ? JSON.stringify({ ...service, services: [{ ...service.services[0], taskDefinition: newRevision }] }) : '{}';
    await expect(applyEcsAutomation(input, changed)).rejects.toThrow('automation_ecs_revision_changed');
    const unknown: EcsApplyRunner = async args => args[1] === 'describe-services'
      ? JSON.stringify(service) : JSON.stringify({ ...definition, taskDefinition: {
        ...definition.taskDefinition, containerDefinitions: [{ ...definition.taskDefinition.containerDefinitions[0], entryPoint: [] }],
      } });
    await expect(applyEcsAutomation(input, unknown)).rejects.toThrow('automation_ecs_startup_unknown');
  });
});
