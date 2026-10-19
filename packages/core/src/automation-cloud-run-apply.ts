import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { runCloudCommand } from './automation-cloud-target.js';
import type { CloudCommandRunner, CloudTarget } from './automation-cloud-target.js';
import { isGithubAutomationSelector } from './automation-setup.js';

type GoogleTarget = Extract<CloudTarget, { provider: 'GOOGLE_CLOUD' }>;
export type CloudRunAutomationInput = {
  target: GoogleTarget;
  expectedRevision: string;
  expectedServiceAccount: string;
  planId: string;
  mappings?: ReadonlyArray<{ selector: string; envName: string }>;
  selector?: string;
  envName?: string;
  image: string;
  cliPath: string;
  environment: Record<string, string>;
};
export type CloudRunAutomationResult = { status: 'updated' | 'already_configured'; revision: string };

const UUID = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/;
const DIGEST_IMAGE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f\d]{64}$/i;
const clean = (value: string): boolean => !!value && !/[\x00-\x1f\x7f]/.test(value);
const execFileAsync = promisify(execFile);
const runCloudMutation: CloudCommandRunner = async (binary, args) => {
  try {
    const { stdout } = await execFileAsync(binary, args, {
      timeout: 900_000, maxBuffer: 1024 * 1024, windowsHide: true,
    });
    return stdout;
  } catch {
    // Provider stderr can contain credentials or environment data.
    throw new Error('automation_cloud_apply_failed');
  }
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('automation_cloud_apply_target_changed');
  return value as Record<string, unknown>;
};
const list = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error('automation_cloud_apply_target_changed');
  return value;
};
const strings = (value: unknown): string[] => list(value).map(item => {
  if (typeof item !== 'string') throw new Error('automation_cloud_apply_target_changed');
  return item;
});
const equal = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const mappingsFor = (input: CloudRunAutomationInput): ReadonlyArray<{ selector: string; envName: string }> =>
  input.mappings ?? (input.selector && input.envName ? [{ selector: input.selector, envName: input.envName }] : []);
const resourceFor = (target: GoogleTarget): { kind: 'jobs' | 'services'; name: string } => {
  if (!!target.job === !!target.service) throw new Error('automation_cloud_apply_input_invalid');
  return target.service ? { kind: 'services', name: target.service } : { kind: 'jobs', name: target.job! };
};

function validate(input: CloudRunAutomationInput): void {
  const resource = resourceFor(input.target);
  const mappings = mappingsFor(input);
  const names = mappings.map(mapping => mapping.envName);
  if (!UUID.test(input.planId) || !/^\d+$/.test(input.expectedRevision) || !clean(input.expectedServiceAccount) ||
      !RESOURCE_ID.test(input.target.project) || !RESOURCE_ID.test(input.target.region) ||
      !RESOURCE_ID.test(resource.name) || (input.target.container && !RESOURCE_ID.test(input.target.container)) ||
      !DIGEST_IMAGE.test(input.image) || !input.cliPath.startsWith('/') || !clean(input.cliPath) ||
      !mappings.length || new Set(names).size !== names.length || mappings.some(({ selector, envName }) =>
        !ENV_NAME.test(envName) || envName.startsWith('INHERITI_AUTOMATION_') || !isGithubAutomationSelector(selector))) {
    throw new Error('automation_cloud_apply_input_invalid');
  }
  if (Object.entries(input.environment).some(([name, value]) =>
    !ENV_NAME.test(name) || !name.startsWith('INHERITI_AUTOMATION_') || !clean(value))) {
    throw new Error('automation_cloud_apply_input_invalid');
  }
  if (input.environment.INHERITI_AUTOMATION_PROVIDER !== 'GOOGLE_CLOUD' ||
      !input.environment.INHERITI_AUTOMATION_CONNECTION_ID ||
      !input.environment.INHERITI_AUTOMATION_AUDIENCE) {
    throw new Error('automation_cloud_apply_input_invalid');
  }
}

function cloudRunContainer(data: Record<string, unknown>, target: GoogleTarget): {
  container: Record<string, unknown>; identity: string; revision: string;
  serviceReady: boolean; serviceTrafficOwned: boolean;
} {
  const template = record(record(data.spec).template);
  const spec = target.service ? record(template.spec) : record(record(record(template.spec).template).spec);
  const containers = list(spec.containers).map(record);
  const matches = target.container ? containers.filter(item => item.name === target.container) : containers;
  if (matches.length !== 1 || typeof spec.serviceAccountName !== 'string') {
    throw new Error('automation_cloud_apply_target_changed');
  }
  const metadata = record(data.metadata);
  const serviceTrafficOwned = !target.service || latestOnlyTraffic(data);
  const serviceReady = serviceTrafficOwned && (!target.service || readyService(data, metadata));
  return {
    container: matches[0]!, identity: spec.serviceAccountName,
    revision: String(metadata.generation ?? ''), serviceReady, serviceTrafficOwned,
  };
}

function latestOnlyTraffic(data: Record<string, unknown>): boolean {
  try {
    const desired = list(record(data.spec).traffic).map(record);
    return desired.length === 1 && desired[0]!.percent === 100 && desired[0]!.latestRevision === true &&
      !desired[0]!.tag && !desired[0]!.revisionName;
  } catch {
    return false;
  }
}

function readyService(data: Record<string, unknown>, metadata: Record<string, unknown>): boolean {
  try {
    const status = record(data.status);
    const actual = list(status.traffic).map(record);
    const ready = list(status.conditions).map(record).find(condition => condition.type === 'Ready');
    const latest = status.latestReadyRevisionName;
    return String(status.observedGeneration) === String(metadata.generation) && ready?.status === 'True' &&
      typeof latest === 'string' && !!latest && latest === status.latestCreatedRevisionName &&
      actual.length === 1 && actual[0]!.percent === 100 && actual[0]!.revisionName === latest && !actual[0]!.tag;
  } catch {
    return false;
  }
}

async function describe(input: CloudRunAutomationInput, run: CloudCommandRunner) {
  const resource = resourceFor(input.target);
  const raw = await run('gcloud', [
    'run', resource.kind, 'describe', resource.name, '--project', input.target.project,
    '--region', input.target.region, '--format=json',
  ]);
  return cloudRunContainer(record(JSON.parse(raw)), input.target);
}

async function updateWithFlags(
  input: CloudRunAutomationInput,
  flags: Record<string, unknown>,
  run: CloudCommandRunner,
): Promise<void> {
  const resource = resourceFor(input.target);
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-cloud-run-'));
  const file = join(directory, 'flags.json');
  try {
    await writeFile(file, JSON.stringify(flags), { mode: 0o600, flag: 'wx' });
    await run('gcloud', [
      'run', resource.kind, 'update', resource.name, '--project', input.target.project,
      '--region', input.target.region, ...(input.target.container ? ['--container', input.target.container] : []),
      `--flags-file=${file}`, '--quiet', '--format=json',
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function applyCloudRunAutomation(
  input: CloudRunAutomationInput,
  run: CloudCommandRunner = runCloudCommand,
): Promise<CloudRunAutomationResult> {
  validate(input);
  const mappings = mappingsFor(input);
  const mutate = run === runCloudCommand ? runCloudMutation : run;
  try {
    const before = await describe(input, run);
    if (!before.serviceReady) throw new Error('automation_cloud_apply_target_changed');
    if (before.identity !== input.expectedServiceAccount) {
      throw new Error('automation_cloud_apply_target_changed');
    }
    const originalCommand = strings(before.container.command ?? []);
    const originalArgs = strings(before.container.args ?? []);
    if (!originalCommand.length) throw new Error('automation_cloud_apply_startup_unknown');
    const env = list(before.container.env ?? []).map(record);
    const desiredEnv = Object.entries(input.environment);
    const command = [input.cliPath];
    const prefix = ['secrets', 'exec', input.planId, '--automation',
      ...mappings.flatMap(({ envName, selector }) => ['--env', `${envName}=${selector}`]), '--'];
    const alreadyConfigured = equal(originalCommand, command) &&
      equal(originalArgs.slice(0, prefix.length), prefix);
    if (originalCommand.length === 1 && basename(originalCommand[0]!) === 'inheriti' &&
        originalArgs[0] === 'secrets' && originalArgs[1] === 'exec' && !alreadyConfigured) {
      throw new Error('automation_cloud_apply_existing_wrapper_conflict');
    }
    const nextArgs = alreadyConfigured ? originalArgs : [...prefix, ...originalCommand, ...originalArgs];
    const currentEnv = new Map(env.map(item => [item.name, item]));
    if (desiredEnv.some(([name]) => currentEnv.has(name) &&
        !equal(currentEnv.get(name), { name, value: input.environment[name] }))) {
      throw new Error('automation_cloud_apply_environment_conflict');
    }
    if (mappings.some(({ envName }) => currentEnv.has(envName))) throw new Error('automation_cloud_apply_environment_conflict');
    if (alreadyConfigured && before.container.image === input.image && desiredEnv.every(([name, value]) =>
      equal(currentEnv.get(name), { name, value }))) {
      return { status: 'already_configured', revision: before.revision };
    }
    if (before.revision !== input.expectedRevision) throw new Error('automation_cloud_apply_target_changed');
    const addedNames = desiredEnv.map(([name]) => name).filter(name => !currentEnv.has(name));
    const flags: Record<string, unknown> = {
      '--command': command,
      '--args': nextArgs,
      '--image': input.image,
      ...(addedNames.length ? { '--update-env-vars': Object.fromEntries(desiredEnv) } : {}),
    };
    const restore = async (after: Awaited<ReturnType<typeof describe>>): Promise<void> => {
      const afterEnv = new Map(list(after.container.env ?? []).map(item => {
        const entry = record(item);
        return [entry.name, entry] as const;
      }));
      const expectedChanges = after.serviceTrafficOwned && after.identity === before.identity && after.container.image === input.image &&
        equal(after.container.command, command) && equal(after.container.args, nextArgs) &&
        desiredEnv.every(([name, value]) => equal(afterEnv.get(name), { name, value }));
      if (!expectedChanges || Number(after.revision) !== Number(before.revision) + 1) {
        throw new Error('automation_cloud_apply_rollback_unconfirmed');
      }
      await updateWithFlags(input, {
        '--command': originalCommand,
        '--args': originalArgs,
        '--image': before.container.image,
        ...(addedNames.length ? { '--remove-env-vars': addedNames } : {}),
      }, mutate);
      const restored = await describe(input, run);
      if (!restored.serviceReady || restored.identity !== before.identity || restored.container.image !== before.container.image ||
          !equal(restored.container.command, originalCommand) || !equal(restored.container.args, originalArgs)) {
        throw new Error('automation_cloud_apply_rollback_unconfirmed');
      }
    };
    const after = await (async () => {
      try {
        await updateWithFlags(input, flags, mutate);
        return await describe(input, run);
      } catch {
        // A provider update may succeed remotely before the local command fails.
        try {
          const afterFailure = await describe(input, run);
          if (equal(afterFailure.container, before.container) && afterFailure.revision === before.revision) {
            throw new Error('automation_cloud_apply_failed');
          }
          await restore(afterFailure);
        } catch (error) {
          if (error instanceof Error && error.message === 'automation_cloud_apply_failed') throw error;
          throw new Error('automation_cloud_apply_rollback_unconfirmed');
        }
        throw new Error('automation_cloud_apply_failed');
      }
    })();
    const afterEnv = new Map(list(after.container.env ?? []).map(item => {
      const entry = record(item);
      return [entry.name, entry] as const;
    }));
    if (!after.serviceReady || after.identity !== before.identity || after.container.image !== input.image ||
        !equal(after.container.command, command) || !equal(after.container.args, nextArgs) ||
        !desiredEnv.every(([name, value]) => equal(afterEnv.get(name), { name, value })) ||
        Number(after.revision) !== Number(before.revision) + 1) {
      try {
        await restore(after);
      } catch {
        throw new Error('automation_cloud_apply_rollback_unconfirmed');
      }
      throw new Error('automation_cloud_apply_unconfirmed');
    }
    return { status: 'updated', revision: after.revision };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('automation_cloud_apply_')) throw error;
    throw new Error('automation_cloud_apply_failed');
  }
}

export async function applyCloudRunServiceAutomation(
  input: CloudRunAutomationInput & { target: Extract<GoogleTarget, { service: string }> },
  run: CloudCommandRunner = runCloudCommand,
): Promise<CloudRunAutomationResult> {
  return applyCloudRunAutomation(input, run);
}
