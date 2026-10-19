import { describe, expect, it, vi } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import { pairCloudRunAutomation } from '../src/automation-cloud-run-pair.js';
import type { CloudRunPairRunner } from '../src/automation-cloud-run-pair.js';

const image = `repo/app@sha256:${'a'.repeat(64)}`;
const input = {
  target: { provider: 'GOOGLE_CLOUD' as const, project: 'sample-project', region: 'us-central1', service: 'app' },
  expectedRevision: '7', expectedSubject: '123456789',
  environment: {
    INHERITI_AUTOMATION_PROVIDER: 'GOOGLE_CLOUD',
    INHERITI_AUTOMATION_CONNECTION_ID: 'connection-1',
    INHERITI_AUTOMATION_AUDIENCE: 'https://example.test/a,b',
  },
  startPairing: vi.fn(async () => undefined),
};
const source = (generation = 7) => JSON.stringify({
  metadata: { generation }, status: { latestReadyRevisionName: 'app-00001' },
  spec: { template: { spec: { serviceAccountName: 'app@sample-project.iam.gserviceaccount.com',
    containers: [{ image: 'repo/app:latest', command: ['run-app'], ports: [{ containerPort: 8080 }],
      env: [{ name: 'SECRET', value: 'private' }] }],
  } } },
});

describe('Cloud Run one-off pairing', () => {
  it('creates an isolated job, starts the window, executes, and deletes the job', async () => {
    const calls: string[][] = [];
    const run: CloudRunPairRunner = async args => {
      calls.push(args);
      if (args[1] === 'services') return source();
      if (args[0] === 'iam') return '123456789\n';
      if (args[1] === 'revisions') return JSON.stringify({ spec: { serviceAccountName: 'app@sample-project.iam.gserviceaccount.com' }, status: { imageDigest: image } });
      if (args[2] === 'create') {
        const path = args[args.indexOf('--env-vars-file') + 1]!;
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(input.environment);
        expect(args).toContain(image);
        expect(args.join(' ')).not.toContain('private');
      }
      return '{}';
    };
    const result = await pairCloudRunAutomation(input, run);
    expect(result).toMatchObject({ status: 'paired' });
    expect(calls.filter(args => args[1] === 'jobs').map(args => args[2])).toEqual(['create', 'execute', 'delete']);
    expect(input.startPairing).toHaveBeenCalledOnce();
  });

  it('rejects a changed workload before opening a window', async () => {
    const run: CloudRunPairRunner = async args => args[1] === 'services' ? source(8) : '{}';
    await expect(pairCloudRunAutomation(input, run)).rejects.toThrow('automation_cloud_run_pair_source_changed');
  });

  it('deletes the job when opening the pairing window fails', async () => {
    const calls: string[][] = [];
    const run: CloudRunPairRunner = async args => {
      calls.push(args);
      if (args[1] === 'services') return source();
      if (args[0] === 'iam') return '123456789\n';
      if (args[1] === 'revisions') return JSON.stringify({ spec: { serviceAccountName: 'app@sample-project.iam.gserviceaccount.com' }, status: { imageDigest: image } });
      return '{}';
    };
    await expect(pairCloudRunAutomation({ ...input, startPairing: async () => { throw new Error('failed'); } }, run))
      .rejects.toThrow('automation_cloud_run_pair_window_failed');
    expect(calls.filter(args => args[1] === 'jobs').map(args => args[2])).toEqual(['create', 'delete']);
  });

  it('pairs from an existing job without changing its own command', async () => {
    const calls: string[][] = [];
    const run: CloudRunPairRunner = async args => {
      calls.push(args);
      if (args[1] === 'jobs' && args[2] === 'describe') return JSON.stringify({
        metadata: { generation: 3 }, spec: { template: { spec: { template: { spec: {
          serviceAccountName: 'app@sample-project.iam.gserviceaccount.com',
          containers: [{ image, command: ['existing-command'] }],
        } } } } },
      });
      if (args[0] === 'iam') return '123456789\n';
      return '{}';
    };
    await pairCloudRunAutomation({ ...input, target: { provider: 'GOOGLE_CLOUD', project: 'sample-project',
      region: 'us-central1', job: 'existing-job' }, expectedRevision: '3' }, run);
    expect(calls.filter(args => args[1] === 'jobs').map(args => args[2])).toEqual(['describe', 'create', 'execute', 'delete']);
    expect(calls.find(args => args[2] === 'create')).toContain('/usr/local/bin/inheriti');
  });

  it('tries to remove a job if creation returns an ambiguous provider error', async () => {
    const calls: string[][] = [];
    const run: CloudRunPairRunner = async args => {
      calls.push(args);
      if (args[1] === 'services') return source();
      if (args[0] === 'iam') return '123456789\n';
      if (args[1] === 'revisions') return JSON.stringify({ spec: { serviceAccountName: 'app@sample-project.iam.gserviceaccount.com' }, status: { imageDigest: image } });
      if (args[2] === 'create') throw new Error('provider timeout');
      return '{}';
    };
    await expect(pairCloudRunAutomation(input, run)).rejects.toThrow('provider timeout');
    expect(calls.filter(args => args[1] === 'jobs').map(args => args[2])).toEqual(['create', 'delete']);
  });

  it('refuses a source VPC configuration before creating a job or opening pairing', async () => {
    const calls: string[][] = [];
    const run: CloudRunPairRunner = async args => {
      calls.push(args);
      if (args[0] === 'iam') return '123456789\n';
      return JSON.stringify({ ...JSON.parse(source()), metadata: {
        generation: 7, annotations: { 'run.googleapis.com/vpc-access-connector': 'private-connector' },
      } });
    };
    await expect(pairCloudRunAutomation(input, run)).rejects.toThrow('automation_cloud_run_pair_network_unsupported');
    expect(calls.some(args => args[2] === 'create')).toBe(false);
  });

  it('refuses VPC settings nested in an existing job task template', async () => {
    const calls: string[][] = [];
    const run: CloudRunPairRunner = async args => {
      calls.push(args);
      if (args[0] === 'iam') return '123456789\n';
      return JSON.stringify({ metadata: { generation: 3 }, spec: { template: { spec: { template: {
        metadata: { annotations: { 'run.googleapis.com/vpc-access-connector': 'private-connector' } },
        spec: { serviceAccountName: 'app@sample-project.iam.gserviceaccount.com', containers: [{ image }] },
      } } } } });
    };
    await expect(pairCloudRunAutomation({ ...input, target: { provider: 'GOOGLE_CLOUD',
      project: 'sample-project', region: 'us-central1', job: 'existing-job' }, expectedRevision: '3' }, run))
      .rejects.toThrow('automation_cloud_run_pair_network_unsupported');
    expect(calls.some(args => args[2] === 'create')).toBe(false);
  });
});
