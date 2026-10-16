import { describe, expect, it, vi } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import { applyCloudRunAutomation, applyCloudRunServiceAutomation } from '../src/automation-cloud-run-apply.js';
import type { CloudCommandRunner } from '../src/automation-cloud-target.js';

const input = {
  target: { provider: 'GOOGLE_CLOUD' as const, project: 'sample-project', region: 'us-central1', job: 'my-job' },
  expectedRevision: '7',
  expectedServiceAccount: 'job@sample-project.iam.gserviceaccount.com',
  planId: '485384e3-b685-4142-b1ca-95a0b90e56ba',
  selector: 'A1.password', envName: 'APP_PASSWORD',
  image: `example@sha256:${'a'.repeat(64)}`,
  cliPath: '/usr/local/bin/inheriti',
  environment: {
    INHERITI_AUTOMATION_PROVIDER: 'GOOGLE_CLOUD',
    INHERITI_AUTOMATION_CONNECTION_ID: 'a1852f04-650d-4f30-b4f6-6fef78991d52',
    INHERITI_AUTOMATION_AUDIENCE: 'urn:inheriti:automation:connection/a1852f04-650d-4f30-b4f6-6fef78991d52',
  },
};
const original = { command: ['node'], args: ['server.js', '--mode=test'], env: [
  { name: 'EXISTING', value: 'private-existing-value' },
] };
const response = (container: Record<string, unknown>, generation = 7) => JSON.stringify({
  metadata: { generation }, spec: { template: { spec: { template: { spec: {
    serviceAccountName: input.expectedServiceAccount,
    containers: [{ image: input.image, ...container }],
  } } } } },
});

describe('Cloud Run job automation apply', () => {
  it('updates a service with two field mappings and its verified service account', async () => {
    const target = { provider: 'GOOGLE_CLOUD' as const, project: 'sample-project',
      region: 'us-central1', service: 'my-service' };
    const mappings = [
      { selector: 'A1.username', envName: 'APP_USER' },
      { selector: 'A1.password', envName: 'APP_PASSWORD' },
    ];
    const flags: Record<string, unknown>[] = [];
    const calls: string[][] = [];
    const serviceResponse = (updated: boolean) => JSON.stringify({
      metadata: { generation: updated ? 8 : 7 }, spec: { template: { spec: {
        serviceAccountName: input.expectedServiceAccount,
        containers: [{ image: input.image,
          command: updated ? flags[0]!['--command'] : original.command,
          args: updated ? flags[0]!['--args'] : original.args,
          env: updated ? [...original.env, ...Object.entries(input.environment).map(([name, value]) => ({ name, value }))] : original.env,
        }],
      } }, traffic: [{ percent: 100, latestRevision: true }] },
      status: { observedGeneration: updated ? 8 : 7, latestReadyRevisionName: updated ? 'app-00002' : 'app-00001',
        latestCreatedRevisionName: updated ? 'app-00002' : 'app-00001',
        conditions: [{ type: 'Ready', status: 'True' }],
        traffic: [{ percent: 100, revisionName: updated ? 'app-00002' : 'app-00001' }],
      },
    });
    const run: CloudCommandRunner = async (_, args) => {
      calls.push(args);
      if (args[2] === 'describe') return serviceResponse(flags.length > 0);
      const file = args.find(arg => arg.startsWith('--flags-file='))!.slice('--flags-file='.length);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      flags.push(JSON.parse(await readFile(file, 'utf8')));
      return '{}';
    };
    await expect(applyCloudRunServiceAutomation({ ...input, target, mappings }, run))
      .resolves.toEqual({ status: 'updated', revision: '8' });
    expect(flags[0]!['--args']).toEqual(['secrets', 'exec', input.planId, '--automation',
      '--env', 'APP_USER=A1.username', '--env', 'APP_PASSWORD=A1.password', '--', ...original.command, ...original.args]);
    expect(calls.filter(args => args[2] === 'update')[0]?.slice(0, 4)).toEqual(['run', 'services', 'update', 'my-service']);
    expect(JSON.stringify(calls)).not.toContain('private-existing-value');
  });

  it('refuses a service with split traffic before updating', async () => {
    const target = { provider: 'GOOGLE_CLOUD' as const, project: 'sample-project',
      region: 'us-central1', service: 'my-service' };
    const run = vi.fn<CloudCommandRunner>().mockResolvedValue(JSON.stringify({
      metadata: { generation: 7 }, spec: { template: { spec: {
        serviceAccountName: input.expectedServiceAccount, containers: [{ image: input.image, ...original }],
      } }, traffic: [{ percent: 50, latestRevision: true }, { percent: 50, revisionName: 'old' }] },
      status: { observedGeneration: 7, latestReadyRevisionName: 'app-00002', latestCreatedRevisionName: 'app-00002',
        conditions: [{ type: 'Ready', status: 'True' }],
        traffic: [{ percent: 50, revisionName: 'app-00002' }, { percent: 50, revisionName: 'old' }],
      },
    }));
    await expect(applyCloudRunServiceAutomation({ ...input, target }, run))
      .rejects.toThrow('automation_cloud_apply_target_changed');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reports unconfirmed rollback when the post-update service cannot be read', async () => {
    const target = { provider: 'GOOGLE_CLOUD' as const, project: 'sample-project',
      region: 'us-central1', service: 'my-service' };
    const ready = JSON.stringify({
      metadata: { generation: 7 }, spec: { template: { spec: {
        serviceAccountName: input.expectedServiceAccount, containers: [{ image: input.image, ...original }],
      } }, traffic: [{ percent: 100, latestRevision: true }] },
      status: { observedGeneration: 7, latestReadyRevisionName: 'app-00001', latestCreatedRevisionName: 'app-00001',
        conditions: [{ type: 'Ready', status: 'True' }], traffic: [{ percent: 100, revisionName: 'app-00001' }],
      },
    });
    const calls: string[][] = [];
    const run: CloudCommandRunner = async (_, args) => {
      calls.push(args);
      if (args[2] === 'describe' && calls.length === 1) return ready;
      if (args[2] === 'describe') throw new Error('provider unavailable');
      return '{}';
    };
    await expect(applyCloudRunServiceAutomation({ ...input, target }, run))
      .rejects.toThrow('automation_cloud_apply_rollback_unconfirmed');
    expect(calls.filter(args => args[2] === 'describe')).toHaveLength(3);
    expect(calls.filter(args => args[2] === 'update')).toHaveLength(1);
  });

  it('rolls back its failed service revision while the previous revision still serves traffic', async () => {
    const target = { provider: 'GOOGLE_CLOUD' as const, project: 'sample-project',
      region: 'us-central1', service: 'my-service' };
    const flags: Record<string, unknown>[] = [];
    const responseFor = (phase: number) => JSON.stringify({
      metadata: { generation: 7 + phase },
      spec: { template: { spec: { serviceAccountName: input.expectedServiceAccount,
        containers: [{ image: input.image,
          command: phase === 1 ? flags[0]!['--command'] : original.command,
          args: phase === 1 ? flags[0]!['--args'] : original.args,
          env: phase === 1 ? [...original.env, ...Object.entries(input.environment).map(([name, value]) => ({ name, value }))] : original.env,
        }],
      } }, traffic: [{ percent: 100, latestRevision: true }] },
      status: { observedGeneration: 7 + phase,
        latestReadyRevisionName: phase === 2 ? 'app-00003' : 'app-00001',
        latestCreatedRevisionName: phase === 0 ? 'app-00001' : phase === 1 ? 'app-00002' : 'app-00003',
        conditions: [{ type: 'Ready', status: phase === 1 ? 'False' : 'True' }],
        traffic: [{ percent: 100, revisionName: phase === 2 ? 'app-00003' : 'app-00001' }],
      },
    });
    const run: CloudCommandRunner = async (_, args) => {
      if (args[2] === 'describe') return responseFor(flags.length);
      const file = args.find(arg => arg.startsWith('--flags-file='))!.slice('--flags-file='.length);
      flags.push(JSON.parse(await readFile(file, 'utf8')));
      return '{}';
    };
    await expect(applyCloudRunServiceAutomation({ ...input, target }, run))
      .rejects.toThrow('automation_cloud_apply_unconfirmed');
    expect(flags).toHaveLength(2);
    expect(flags[1]!['--command']).toEqual(original.command);
    expect(flags[1]!['--args']).toEqual(original.args);
  });
  it('updates a job with restricted flags file and preserves existing environment', async () => {
    const calls: string[][] = [];
    const flags: Record<string, unknown>[] = [];
    const run: CloudCommandRunner = async (_, args) => {
      calls.push(args);
      if (args[2] === 'describe') return response(flags.length ? {
        command: flags[0]!['--command'], args: flags[0]!['--args'], env: [
          ...original.env,
          ...Object.entries(input.environment).map(([name, value]) => ({ name, value })),
        ],
      } : original, flags.length ? 8 : 7);
      const file = args.find(arg => arg.startsWith('--flags-file='))!.slice('--flags-file='.length);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      flags.push(JSON.parse(await readFile(file, 'utf8')));
      return '{}';
    };
    await expect(applyCloudRunAutomation(input, run)).resolves.toEqual({ status: 'updated', revision: '8' });
    expect(flags).toHaveLength(1);
    expect(flags[0]!['--command']).toEqual(['/usr/local/bin/inheriti']);
    expect(flags[0]!['--args']).toEqual([
      'secrets', 'exec', input.planId, '--automation', '--env', 'APP_PASSWORD=A1.password', '--',
      'node', 'server.js', '--mode=test',
    ]);
    expect(flags[0]!['--update-env-vars']).toEqual(input.environment);
    expect(flags[0]).not.toHaveProperty('--set-env-vars');
    expect(calls.filter(args => args[2] === 'update')).toHaveLength(1);
    expect(JSON.stringify(calls)).not.toContain('private-existing-value');
  });

  it('returns without updating an already configured job', async () => {
    const run = vi.fn<CloudCommandRunner>().mockResolvedValue(response({
      image: input.image,
      command: ['/usr/local/bin/inheriti'],
      args: ['secrets', 'exec', input.planId, '--automation', '--env', 'APP_PASSWORD=A1.password', '--', 'node'],
      env: Object.entries(input.environment).map(([name, value]) => ({ name, value })),
    }, 9));
    await expect(applyCloudRunAutomation(input, run)).resolves.toEqual({ status: 'already_configured', revision: '9' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('refuses a changed revision and an existing conflicting environment', async () => {
    const run = vi.fn<CloudCommandRunner>().mockResolvedValue(response(original, 8));
    await expect(applyCloudRunAutomation(input, run)).rejects.toThrow('automation_cloud_apply_target_changed');
    expect(run).toHaveBeenCalledTimes(1);
    const collision = vi.fn<CloudCommandRunner>().mockResolvedValue(response({ ...original,
      env: [...original.env, { name: 'APP_PASSWORD', value: 'existing' }],
    }));
    await expect(applyCloudRunAutomation(input, collision)).rejects.toThrow('automation_cloud_apply_environment_conflict');
    expect(collision).toHaveBeenCalledTimes(1);
  });

  it('rejects a mutable image before invoking gcloud', async () => {
    const run = vi.fn<CloudCommandRunner>();
    await expect(applyCloudRunAutomation({ ...input, image: 'example:latest' }, run))
      .rejects.toThrow('automation_cloud_apply_input_invalid');
    expect(run).not.toHaveBeenCalled();
  });

  it('allows a prepared immutable image and restores the old image after an ambiguous update failure', async () => {
    const oldImage = `old.example@sha256:${'b'.repeat(64)}`;
    const flags: Record<string, unknown>[] = [];
    const run: CloudCommandRunner = async (_, args) => {
      if (args[2] === 'describe') return response(flags.length === 1 ? {
        ...original,
        image: input.image,
        command: flags[0]!['--command'], args: flags[0]!['--args'],
        env: [...original.env, ...Object.entries(input.environment).map(([name, value]) => ({ name, value }))],
      } : { ...original, image: oldImage }, 7 + flags.length);
      const file = args.find(arg => arg.startsWith('--flags-file='))!.slice('--flags-file='.length);
      flags.push(JSON.parse(await readFile(file, 'utf8')));
      if (flags.length === 1) throw new Error('provider diagnostics could include a secret');
      return '{}';
    };
    await expect(applyCloudRunAutomation(input, run)).rejects.toThrow('automation_cloud_apply_failed');
    expect(flags).toHaveLength(2);
    expect(flags[0]!['--image']).toBe(input.image);
    expect(flags[1]!['--image']).toBe(oldImage);
    expect(flags[1]!['--remove-env-vars']).toEqual(Object.keys(input.environment));
  });

  it('does not overwrite another actor when an update fails and the job has changed unexpectedly', async () => {
    const calls: string[][] = [];
    const run: CloudCommandRunner = async (_, args) => {
      calls.push(args);
      if (args[2] === 'describe') return calls.filter(call => call[2] === 'describe').length === 1
        ? response(original)
        : response({ ...original, command: ['another-owner'] }, 8);
      throw new Error('provider diagnostics must not escape');
    };
    await expect(applyCloudRunAutomation(input, run))
      .rejects.toThrow('automation_cloud_apply_rollback_unconfirmed');
    expect(calls.filter(args => args[2] === 'update')).toHaveLength(1);
  });

  it('refuses to nest an existing Inheriti wrapper for another plan field', async () => {
    const run = vi.fn<CloudCommandRunner>().mockResolvedValue(response({
      command: ['/opt/inheriti'],
      args: ['secrets', 'exec', input.planId, '--automation', '--env', 'APP_PASSWORD=A1.oldField', '--', 'node'],
    }));
    await expect(applyCloudRunAutomation(input, run))
      .rejects.toThrow('automation_cloud_apply_existing_wrapper_conflict');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
