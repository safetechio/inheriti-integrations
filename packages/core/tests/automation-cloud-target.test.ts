import { describe, expect, it, vi } from 'vitest';
import { inspectCloudIdentity, inspectCloudTarget, inspectCloudTargetForPairing, previewCloudTarget, runningEcsServiceImage } from '../src/automation-cloud-target.js';
import type { CloudCommandRunner } from '../src/automation-cloud-target.js';

const cloudRun = { provider: 'GOOGLE_CLOUD' as const, project: 'test-project', region: 'us-central1', job: 'backup-job' };
const ecs = { provider: 'AWS' as const, region: 'us-east-1', cluster: 'test-cluster', service: 'backup-service' };
const cloudRunResponse = (containers: Record<string, unknown>[]) => JSON.stringify({
  apiVersion: 'run.googleapis.com/v1',
  metadata: { generation: 7 },
  spec: { template: { spec: { template: { spec: {
    serviceAccountName: 'job@test-project.iam.gserviceaccount.com',
    containers,
  } } } } },
});

describe('running ECS service image', () => {
  const image = '123456789012.dkr.ecr.us-east-1.amazonaws.com/worker:v1';
  const inspected = { target: ecs, image, container: 'app', revision: 'revision:1', command: [],
    environmentNames: [], identity: 'role' };
  const digest = 'sha256:' + 'a'.repeat(64);
  const running = (containers: Record<string, unknown>[], revision = 'revision:1') => ({
    taskDefinitionArn: revision, lastStatus: 'RUNNING', healthStatus: 'HEALTHY', containers,
  });
  const runner = (tasks: Record<string, unknown>[]): CloudCommandRunner => async (_, args) =>
    JSON.stringify(args[1] === 'list-tasks' ? { taskArns: ['task-1'] } : { tasks });

  it('uses the running selected container digest even when the registry tag could have moved', async () => {
    const run = vi.fn(runner([running([{ name: 'sidecar', imageDigest: 'sha256:' + 'b'.repeat(64) },
      { name: 'app', imageDigest: digest }])]));
    await expect(runningEcsServiceImage(inspected, run)).resolves.toBe(`${image.slice(0, -3)}@${digest}`);
    expect(run.mock.calls.map(([, args]) => args[1])).toEqual(['list-tasks', 'describe-tasks']);
  });

  it.each(['nginx:stable', 'registry.example.test:5000/team/app:v2', 'registry.example.test:5000/team/app',
    'registry.example.test:5000/team/app@sha256:' + 'a'.repeat(64)])(
    'pins a running image from %s', async source => {
      const repository = source.includes('@') ? source.split('@')[0]!
        : source.lastIndexOf(':') > source.lastIndexOf('/') ? source.slice(0, source.lastIndexOf(':')) : source;
      await expect(runningEcsServiceImage({ ...inspected, image: source },
        runner([running([{ name: 'app', lastStatus: 'RUNNING', imageDigest: digest }])])))
        .resolves.toBe(`${repository}@${digest}`);
    });

  it('rejects missing, mixed and stale running digests', async () => {
    await expect(runningEcsServiceImage(inspected, runner([running([{ name: 'app' }])])))
      .rejects.toThrow('automation_ecs_running_image_unavailable');
    await expect(runningEcsServiceImage(inspected, runner([running([{ name: 'app', imageDigest: digest }]),
      running([{ name: 'app', imageDigest: 'sha256:' + 'b'.repeat(64) }])])))
      .rejects.toThrow('automation_ecs_running_image_unavailable');
    await expect(runningEcsServiceImage(inspected, runner([running([{ name: 'app', imageDigest: digest }], 'revision:2')])))
      .rejects.toThrow('automation_ecs_running_image_unavailable');
    await expect(runningEcsServiceImage(inspected, runner([running([{ name: 'app', lastStatus: 'STOPPED', imageDigest: digest }])])))
      .rejects.toThrow('automation_ecs_running_image_unavailable');
  });
});
const cloudRunServiceResponse = (containers: Record<string, unknown>[]) => JSON.stringify({
  metadata: { generation: 11 }, spec: { template: { spec: {
    serviceAccountName: 'app@test-project.iam.gserviceaccount.com', containers,
  } } },
});

describe('cloud target inspection', () => {
  it('inspects Cloud Run Service identity and startup without exposing environment values', async () => {
    const calls: string[][] = [];
    const result = await inspectCloudTarget({ provider: 'GOOGLE_CLOUD', project: 'test-project',
      region: 'us-central1', service: 'app' }, async (_, args) => {
      calls.push(args);
      return args[0] === 'iam' ? '123456789\n' : cloudRunServiceResponse([{
        image: 'example@sha256:abc', command: ['node'], args: ['server.js'],
        env: [{ name: 'PRIVATE', value: 'do-not-return' }],
      }]);
    });
    expect(result).toMatchObject({ command: ['node', 'server.js'], revision: '11',
      identity: 'app@test-project.iam.gserviceaccount.com', identityNumericId: '123456789' });
    expect(JSON.stringify(result)).not.toContain('do-not-return');
    expect(calls[0]).toEqual(['run', 'services', 'describe', 'app', '--project', 'test-project',
      '--region', 'us-central1', '--format=json']);
  });
  it('inspects Cloud Run without returning environment values', async () => {
    const calls: [string, string[]][] = [];
    const run: CloudCommandRunner = async (binary, args) => {
      calls.push([binary, args]);
      return args[0] === 'iam' ? '123456789\n' : cloudRunResponse([{
        image: 'example@sha256:abc',
        command: ['node'],
        args: ['server.js'],
        env: [{ name: 'SENSITIVE', value: 'do-not-return' }],
      }]);
    };
    const result = await inspectCloudTarget(cloudRun, run);
    expect(result.command).toEqual(['node', 'server.js']);
    expect(result.identityNumericId).toBe('123456789');
    expect(result.container).toBe('');
    expect(result.revision).toBe('7');
    expect(result.environmentNames).toEqual(['SENSITIVE']);
    expect(JSON.stringify(result)).not.toContain('do-not-return');
    expect(calls).toEqual([
      ['gcloud', ['run', 'jobs', 'describe', 'backup-job', '--project', 'test-project', '--region', 'us-central1', '--format=json']],
      ['gcloud', [
        'iam', 'service-accounts', 'describe', 'job@test-project.iam.gserviceaccount.com',
        '--project', 'test-project', '--format=value(uniqueId)',
      ]],
    ]);
    const preview = previewCloudTarget(result, '/opt/inheriti/launch.sh', ['INHERITI_AUTOMATION_CONNECTION_ID']);
    expect(JSON.stringify(preview)).not.toContain('server.js');
    expect(JSON.stringify(preview)).not.toContain('do-not-return');
    expect(preview).toMatchObject({
      startupCommandWillChange: true, proposedLauncherPath: '/opt/inheriti/launch.sh',
      addedEnvironmentNames: ['INHERITI_AUTOMATION_CONNECTION_ID'],
    });
  });

  it('inspects ECS service task role and explicit startup', async () => {
    const run: CloudCommandRunner = async (_, args) => args[1] === 'describe-services'
      ? JSON.stringify({
        services: [{ taskDefinition: 'arn:aws:ecs:us-east-1:123456789012:task-definition/app:3', healthCheckGracePeriodSeconds: 180 }],
        failures: [],
      })
      : JSON.stringify({ taskDefinition: {
        taskDefinitionArn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/app:3',
        taskRoleArn: 'arn:aws:iam::123456789012:role/app',
        containerDefinitions: [{
          name: 'app', image: 'example:3', entryPoint: ['/bin/sh', '-c'],
          command: ['exec node server.js'],
          environment: [{ name: 'SECRET', value: 'do-not-return' }],
        }],
      } });
    const result = await inspectCloudTarget(ecs, run);
    expect(result.command).toEqual(['/bin/sh', '-c', 'exec node server.js']);
    expect(result.identity).toBe('arn:aws:iam::123456789012:role/app');
    expect(previewCloudTarget(result, '/opt/inheriti/launch.sh', []).healthCheckGracePeriodSeconds).toBe(180);
    expect(previewCloudTarget(result, '/opt/inheriti/launch.sh', []).healthCheckGraceWarning).toContain('manual SafeKey approval');
    expect(JSON.stringify(result)).not.toContain('do-not-return');
  });

  it('identifies an ECS service with only an execution role', async () => {
    const run: CloudCommandRunner = async (_, args) => args[1] === 'describe-services'
      ? JSON.stringify({ services: [{ taskDefinition: 'app:2' }], failures: [] })
      : JSON.stringify({ taskDefinition: {
        taskDefinitionArn: 'app:2', executionRoleArn: 'arn:aws:iam::123456789012:role/execution',
        containerDefinitions: [{ name: 'app', image: 'example:2' }],
      } });
    await expect(inspectCloudIdentity(ecs, run)).rejects.toThrow('automation_ecs_task_role_missing');
  });

  it('pairs an ECS service that inherits its image entry point', async () => {
    const run: CloudCommandRunner = async (_, args) => args[1] === 'describe-services'
      ? JSON.stringify({ services: [{ taskDefinition: 'arn:aws:ecs:us-east-1:123456789012:task-definition/app:3' }], failures: [] })
      : JSON.stringify({ taskDefinition: {
        taskDefinitionArn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/app:3',
        taskRoleArn: 'arn:aws:iam::123456789012:role/app',
        containerDefinitions: [{ name: 'app', image: 'example:3' }],
      } });
    await expect(inspectCloudTarget(ecs, run)).rejects.toThrow('automation_cloud_startup_unknown');
    await expect(inspectCloudTargetForPairing(ecs, run)).resolves.toMatchObject({
      identity: 'arn:aws:iam::123456789012:role/app',
      revision: 'arn:aws:ecs:us-east-1:123456789012:task-definition/app:3',
    });
  });

  it('inspects a Cloud Run service for pairing without requiring an explicit startup command', async () => {
    const target = { provider: 'GOOGLE_CLOUD' as const, project: 'test-project', region: 'us-central1', service: 'app' };
    const run: CloudCommandRunner = async (_, args) => args[0] === 'iam' ? '123456789\n'
      : cloudRunServiceResponse([{ image: 'example:latest' }]);
    await expect(inspectCloudTarget(target, run)).rejects.toThrow('automation_cloud_startup_unknown');
    await expect(inspectCloudTargetForPairing(target, run)).resolves.toMatchObject({
      revision: '11', identityNumericId: '123456789',
    });
  });

  it('refuses implicit image startup and multiple containers', async () => {
    const run: CloudCommandRunner = async () => cloudRunResponse([{
      name: 'app', image: 'example:1', args: ['serve'],
    }]);
    await expect(inspectCloudTarget(cloudRun, run)).rejects.toThrow('automation_cloud_startup_unknown');
    await expect(inspectCloudIdentity(cloudRun, async (_, args) =>
      args[0] === 'iam' ? '123456789\n' : cloudRunResponse([{
        name: 'app', image: 'example:1', args: ['serve'],
      }]))).resolves.toEqual({
      identity: 'job@test-project.iam.gserviceaccount.com',
      identityNumericId: '123456789',
    });
    await expect(inspectCloudTarget(cloudRun, async () => cloudRunResponse([
      { name: 'a' }, { name: 'b' },
    ]))).rejects.toThrow('automation_cloud_container_ambiguous');
  });

  it('rejects malformed target input before invoking a provider CLI', async () => {
    const run = vi.fn<CloudCommandRunner>().mockResolvedValue('{}');
    await expect(inspectCloudTarget({ ...cloudRun, job: '--delete' }, run))
      .rejects.toThrow('automation_cloud_target_invalid');
    expect(run).not.toHaveBeenCalled();
  });
});
