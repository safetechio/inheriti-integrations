import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { pairEcsAutomation } from '../src/automation-ecs-pair.js';
import type { EcsPairInput, EcsPairRunner } from '../src/automation-ecs-pair.js';

const revision = 'arn:aws:ecs:us-east-1:123456789012:task-definition/app:3';
const paired = 'arn:aws:ecs:us-east-1:123456789012:task-definition/inheriti-pair:1';
const task = 'arn:aws:ecs:us-east-1:123456789012:task/cluster/1234';
const input: EcsPairInput = {
  target: { provider: 'AWS', region: 'us-east-1', cluster: 'cluster', service: 'service' },
  expectedRevision: revision, expectedRoleArn: 'arn:aws:iam::123456789012:role/app',
  image: `example@sha256:${'a'.repeat(64)}`, cliPath: '/opt/inheriti/bin/inheriti',
  environment: { AWS_REGION: 'us-east-1', INHERITI_AUTOMATION_PROVIDER: 'AWS',
    INHERITI_AUTOMATION_CONNECTION_ID: 'connection' },
  startPairing: vi.fn(async () => {}),
};
const service = { services: [{ status: 'ACTIVE', deploymentController: { type: 'ECS' }, taskDefinition: revision,
  launchType: 'FARGATE', platformVersion: '1.4.0',
  networkConfiguration: { awsvpcConfiguration: { subnets: ['subnet-123'], securityGroups: ['sg-123'], assignPublicIp: 'DISABLED' } },
}], failures: [] };
const definition = { taskDefinition: { taskDefinitionArn: revision, family: 'app', taskRoleArn: input.expectedRoleArn,
  executionRoleArn: 'arn:aws:iam::123456789012:role/execution', networkMode: 'awsvpc', requiresCompatibilities: ['FARGATE'],
  cpu: '256', memory: '512', containerDefinitions: [{ name: 'app', image: 'example:old',
    secrets: [{ name: 'SECRET', valueFrom: 'secret-arn' }], environment: [{ name: 'PRIVATE', value: 'private-value' }] }] } };

describe('ECS one-off pairing', () => {
  it('rejects credentials in the temporary task environment', async () => {
    const runner = vi.fn<EcsPairRunner>();
    await expect(pairEcsAutomation({ ...input,
      environment: { ...input.environment, AWS_SECRET_ACCESS_KEY: 'never' },
    }, runner)).rejects.toThrow('automation_ecs_pair_input_invalid');
    expect(runner).not.toHaveBeenCalled();
  });

  it('starts pairing after registration, runs a clean task, and leaves the service alone', async () => {
    const calls: string[] = [];
    const startPairing = vi.fn(async () => { calls.push('start-pairing'); });
    const runner: EcsPairRunner = async args => {
      calls.push(args[1]!);
      if (args[1] === 'describe-services') return JSON.stringify(service);
      if (args[1] === 'describe-task-definition') return JSON.stringify(definition);
      if (args[1] === 'register-task-definition') {
        const body = JSON.parse(await readFile(args[args.indexOf('--cli-input-json') + 1]!.slice(7), 'utf8'));
        expect(body.taskRoleArn).toBe(input.expectedRoleArn);
        expect(body.containerDefinitions).toEqual([{ name: 'app', image: input.image, essential: true,
          entryPoint: [input.cliPath], command: ['automations', 'pair', 'redeem'],
          environment: Object.entries(input.environment).map(([name, value]) => ({ name, value })) }]);
        expect(JSON.stringify(body)).not.toContain('private-value');
        return JSON.stringify({ taskDefinition: { taskDefinitionArn: paired } });
      }
      if (args[1] === 'run-task') {
        const body = JSON.parse(await readFile(args[args.indexOf('--cli-input-json') + 1]!.slice(7), 'utf8'));
        expect(body.launchType).toBe('FARGATE');
        expect(body.networkConfiguration).toEqual(service.services[0]!.networkConfiguration);
        return JSON.stringify({ tasks: [{ taskArn: task }], failures: [] });
      }
      if (args[1] === 'describe-tasks') return JSON.stringify({ tasks: [{ lastStatus: 'STOPPED', containers: [{ name: 'app', exitCode: 0 }] }], failures: [] });
      if (args[1] === 'deregister-task-definition') return '{}';
      return '';
    };
    await expect(pairEcsAutomation({ ...input, startPairing }, runner)).resolves.toEqual({ taskArn: task, taskDefinitionArn: paired, status: 'paired' });
    expect(calls).toEqual(['describe-services', 'describe-task-definition', 'register-task-definition', 'start-pairing',
      'run-task', 'wait', 'describe-tasks', 'deregister-task-definition']);
    expect(calls).not.toContain('update-service');
  });

  it('deregisters after a failed proof and rejects changed identity before registration', async () => {
    const calls: string[] = [];
    const runner: EcsPairRunner = async args => {
      calls.push(args[1]!);
      if (args[1] === 'describe-services') return JSON.stringify(service);
      if (args[1] === 'describe-task-definition') return JSON.stringify(definition);
      if (args[1] === 'register-task-definition') return JSON.stringify({ taskDefinition: { taskDefinitionArn: paired } });
      if (args[1] === 'run-task') return JSON.stringify({ tasks: [{ taskArn: task }], failures: [] });
      if (args[1] === 'describe-tasks') return JSON.stringify({ tasks: [{ lastStatus: 'STOPPED', containers: [{ name: 'app', exitCode: 1 }] }], failures: [] });
      if (args[1] === 'deregister-task-definition') return '{}';
      return '';
    };
    await expect(pairEcsAutomation(input, runner)).rejects.toThrow('automation_ecs_pair_failed');
    expect(calls.at(-1)).toBe('deregister-task-definition');
    const changed: EcsPairRunner = async args => args[1] === 'describe-services' ? JSON.stringify(service)
      : JSON.stringify({ taskDefinition: { ...definition.taskDefinition, taskRoleArn: 'arn:aws:iam::123456789012:role/other' } });
    await expect(pairEcsAutomation(input, changed)).rejects.toThrow('automation_ecs_pair_identity_changed');
  });

  it('stops a launched task on cancellation and deregisters its definition', async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const runner: EcsPairRunner = async (args, signal) => {
      calls.push(args[1]!);
      if (args[1] === 'describe-services') return JSON.stringify(service);
      if (args[1] === 'describe-task-definition') return JSON.stringify(definition);
      if (args[1] === 'register-task-definition') return JSON.stringify({ taskDefinition: { taskDefinitionArn: paired } });
      if (args[1] === 'run-task') return JSON.stringify({ tasks: [{ taskArn: task }], failures: [] });
      if (args[1] === 'wait') {
        expect(signal).toBe(controller.signal);
        controller.abort();
        throw new Error('aborted');
      }
      if (args[1] === 'stop-task' || args[1] === 'deregister-task-definition') {
        expect(signal).toBeUndefined();
        return '{}';
      }
      return '';
    };
    await expect(pairEcsAutomation({ ...input, signal: controller.signal }, runner))
      .rejects.toThrow('automation_ecs_pair_wait_failed');
    expect(calls.slice(-3)).toEqual(['wait', 'stop-task', 'deregister-task-definition']);
  });

  it('preserves EC2 container memory when the task has no task-level memory', async () => {
    const ec2Service = { services: [{ ...service.services[0], launchType: 'EC2', platformVersion: undefined,
      networkConfiguration: undefined }], failures: [] };
    const ec2Definition = { taskDefinition: { ...definition.taskDefinition, networkMode: 'bridge',
      requiresCompatibilities: ['EC2'], cpu: undefined, memory: undefined,
      containerDefinitions: [{ ...definition.taskDefinition.containerDefinitions[0], memory: 256, memoryReservation: 128 }] } };
    const runner: EcsPairRunner = async args => {
      if (args[1] === 'describe-services') return JSON.stringify(ec2Service);
      if (args[1] === 'describe-task-definition') return JSON.stringify(ec2Definition);
      if (args[1] === 'register-task-definition') {
        const body = JSON.parse(await readFile(args[args.indexOf('--cli-input-json') + 1]!.slice(7), 'utf8'));
        expect(body.containerDefinitions[0].memory).toBe(256);
        expect(body.containerDefinitions[0].memoryReservation).toBe(128);
        expect(body.memory).toBeUndefined();
        return JSON.stringify({ taskDefinition: { taskDefinitionArn: paired } });
      }
      if (args[1] === 'run-task') return JSON.stringify({ tasks: [{ taskArn: task }], failures: [] });
      if (args[1] === 'describe-tasks') return JSON.stringify({ tasks: [{ lastStatus: 'STOPPED', containers: [{ name: 'app', exitCode: 0 }] }], failures: [] });
      return '{}';
    };
    await expect(pairEcsAutomation(input, runner)).resolves.toMatchObject({ status: 'paired' });
  });
});
