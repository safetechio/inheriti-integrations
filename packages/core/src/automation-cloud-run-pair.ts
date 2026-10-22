import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { providerCliError } from './provider-cli-error.js';
import type { CloudTarget } from './automation-cloud-target.js';

const execFileAsync = promisify(execFile);
type GoogleTarget = Extract<CloudTarget, { provider: 'GOOGLE_CLOUD' }>;
export type CloudRunPairInput = {
  target: GoogleTarget;
  expectedRevision: string;
  expectedSubject: string;
  environment: Readonly<Record<string, string>>;
  startPairing: () => Promise<void>;
  signal?: AbortSignal;
};
export type CloudRunPairResult = { jobName: string; status: 'paired' };
export type CloudRunPairRunner = (args: string[], signal?: AbortSignal) => Promise<string>;
const runGoogle: CloudRunPairRunner = async (args, signal) => {
  try {
    const { stdout } = await execFileAsync('gcloud', args, {
      maxBuffer: 1024 * 1024, timeout: args.includes('execute') ? 720_000 : 120_000,
      windowsHide: true, signal,
    });
    return stdout;
  } catch (error) {
    throw providerCliError('gcloud', error, 'automation_cloud_run_pair_provider_failed');
  }
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('automation_cloud_run_pair_response_invalid');
  return value as Record<string, unknown>;
};
const parsed = (value: string): Record<string, unknown> => {
  try { return record(JSON.parse(value)); } catch { throw new Error('automation_cloud_run_pair_response_invalid'); }
};
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,255}$/.test(value);
const imageDigest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*@sha256:[a-f0-9]{64}$/i.test(value);
const safeEnvironment = (environment: Readonly<Record<string, string>>): boolean =>
  environment.INHERITI_AUTOMATION_PROVIDER === 'GOOGLE_CLOUD' &&
  !!environment.INHERITI_AUTOMATION_CONNECTION_ID && !!environment.INHERITI_AUTOMATION_AUDIENCE &&
  Object.entries(environment).every(([key, value]) =>
    ['INHERITI_AUTOMATION_PROVIDER', 'INHERITI_AUTOMATION_CONNECTION_ID', 'INHERITI_AUTOMATION_AUDIENCE'].includes(key) &&
    typeof value === 'string' && !!value && !/[\x00-\x1f\x7f]/.test(value));

/** Verifies a Cloud Run identity with one disposable job; the source workload is never edited. */
export async function pairCloudRunAutomation(
  input: CloudRunPairInput,
  run: CloudRunPairRunner = runGoogle,
): Promise<CloudRunPairResult> {
  const { target } = input;
  if (target.provider !== 'GOOGLE_CLOUD' || !identifier(target.project) || !identifier(target.region) ||
      !!target.job === !!target.service || !identifier(target.job ?? target.service) ||
      !identifier(input.expectedRevision) || !/^\d+$/.test(input.expectedSubject) ||
      !safeEnvironment(input.environment) || typeof input.startPairing !== 'function')
    throw new Error('automation_cloud_run_pair_input_invalid');
  input.signal?.throwIfAborted();
  const call = (args: string[], signal?: AbortSignal): Promise<string> => run(args, signal);
  const resource = target.service ? 'services' : 'jobs';
  const sourceName = target.service ?? target.job!;
  const location = ['--project', target.project, '--region', target.region];
  const source = parsed(await call(['run', resource, 'describe', sourceName, ...location, '--format=json'], input.signal));
  const template = record(record(source.spec).template);
  const runtime = target.service ? record(template.spec) : record(record(template.spec).template).spec;
  const spec = record(runtime);
  const containers = spec.containers;
  if (!Array.isArray(containers) || containers.length !== 1) throw new Error('automation_cloud_run_pair_source_invalid');
  const container = record(containers[0]);
  const revision = String(record(source.metadata).generation ?? '');
  const status = target.service ? record(source.status) : undefined;
  if (status && ((status.observedGeneration !== undefined && String(status.observedGeneration) !== revision) ||
      (status.latestCreatedRevisionName !== undefined && status.latestCreatedRevisionName !== status.latestReadyRevisionName)))
    throw new Error('automation_cloud_run_pair_source_changed');
  const account = spec.serviceAccountName;
  if (revision !== input.expectedRevision || !identifier(account)) throw new Error('automation_cloud_run_pair_source_changed');
  const subject = (await call(['iam', 'service-accounts', 'describe', account, '--project', target.project,
    '--format=value(uniqueId)'], input.signal)).trim();
  if (subject !== input.expectedSubject) throw new Error('automation_cloud_run_pair_identity_changed');
  const annotations = {
    ...record(record(source.metadata).annotations ?? {}),
    ...record(record(template.metadata ?? {}).annotations ?? {}),
    ...record(record(target.service ? {} : record(record(template.spec).template).metadata ?? {}).annotations ?? {}),
  };
  if (Object.keys(annotations).some(key => key.startsWith('run.googleapis.com/vpc-access') ||
      key === 'run.googleapis.com/network-interfaces') ||
      spec.vpcAccess || spec.volumes || container.volumeMounts)
    throw new Error('automation_cloud_run_pair_network_unsupported');
  const readyRevision = status?.latestReadyRevisionName;
  const revisionData = readyRevision && identifier(readyRevision)
    ? parsed(await call(['run', 'revisions', 'describe', readyRevision, ...location, '--format=json'], input.signal))
    : undefined;
  if (revisionData && record(revisionData.spec).serviceAccountName !== account)
    throw new Error('automation_cloud_run_pair_identity_changed');
  const image = revisionData ? record(revisionData.status).imageDigest : container.image;
  if (!imageDigest(image)) throw new Error('automation_cloud_run_pair_image_unpinned');
  const jobName = `inheriti-pair-${randomUUID().slice(0, 12)}`;
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-cloud-pair-'));
  const environmentFile = join(directory, 'environment.json');
  try {
    await writeFile(environmentFile, JSON.stringify(input.environment), { mode: 0o600, flag: 'wx' });
    try {
      await call(['run', 'jobs', 'create', jobName, ...location, '--image', image,
        '--service-account', account, '--command', '/usr/local/bin/inheriti', '--args', 'automations,pair,redeem',
        '--env-vars-file', environmentFile, '--format=json'], input.signal);
    } catch (error) {
      // A provider timeout may leave the uniquely named job behind.
      await call(['run', 'jobs', 'delete', jobName, ...location, '--quiet']).catch(() => undefined);
      throw error;
    }
    try {
      input.signal?.throwIfAborted();
      try { await input.startPairing(); } catch { throw new Error('automation_cloud_run_pair_window_failed'); }
      input.signal?.throwIfAborted();
      // Wait for the execution even after cancellation so cleanup does not abandon a running proof.
      await call(['run', 'jobs', 'execute', jobName, ...location, '--wait', '--format=json']);
      input.signal?.throwIfAborted();
      return { jobName, status: 'paired' };
    } finally {
      await call(['run', 'jobs', 'delete', jobName, ...location, '--quiet']);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
