import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { providerCliError } from './provider-cli-error.js';

const execFileAsync = promisify(execFile);

export type CloudCommandRunner = (binary: 'gcloud' | 'aws', args: string[]) => Promise<string>;
export type CloudTarget =
  | { provider: 'GOOGLE_CLOUD'; project: string; region: string; job: string; service?: never; container?: string }
  | { provider: 'GOOGLE_CLOUD'; project: string; region: string; service: string; job?: never; container?: string }
  | { provider: 'AWS'; region: string; cluster: string; service?: string; taskDefinition?: string; container?: string };
/** Raw provider data for local bundle generation. Never serialize this to MCP or logs. */
export type CloudTargetInspection = {
  target: CloudTarget;
  image: string;
  container: string;
  command: string[];
  environmentNames: string[];
  identity: string;
  identityNumericId?: string;
  revision: string;
};
export type CloudTargetPreview = {
  target: CloudTarget;
  startupCommandWillChange: true;
  proposedLauncherPath: string;
  addedEnvironmentNames: string[];
  image: string;
  identity: string;
  revision: string;
};

export const runCloudCommand: CloudCommandRunner = async (binary, args) => {
  try {
    const { stdout } = await execFileAsync(binary, args, { maxBuffer: 1024 * 1024, windowsHide: true, timeout: 20_000 });
    return stdout;
  } catch (error) {
    throw providerCliError(binary, error, 'automation_cloud_inspection_failed');
  }
};

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('automation_cloud_target_invalid');
  return value as Record<string, unknown>;
};
const string = (value: unknown): string => {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value)) throw new Error('automation_cloud_target_invalid');
  return value;
};
const list = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error('automation_cloud_target_invalid');
  return value;
};
const command = (value: unknown): string[] => list(value).map(string);
const names = (value: unknown): string[] => list(value ?? []).map(item => string(record(item).name));
const parsed = (value: string): Record<string, unknown> => {
  try { return record(JSON.parse(value)); } catch { throw new Error('automation_cloud_inspection_failed'); }
};
const identifier = (value: string): string => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,255}$/.test(value)) throw new Error('automation_cloud_target_invalid');
  return value;
};
const selectContainer = (value: unknown, selected?: string): Record<string, unknown> => {
  const containers = list(value).map(record);
  const matches = selected ? containers.filter(item => item.name === selected) : containers;
  if (matches.length !== 1) throw new Error('automation_cloud_container_ambiguous');
  return matches[0]!;
};

async function resolveEcsTaskDefinition(
  target: Extract<CloudTarget, { provider: 'AWS' }>,
  run: CloudCommandRunner,
): Promise<string> {
  if (!!target.service === !!target.taskDefinition) throw new Error('automation_cloud_target_invalid');
  if (target.taskDefinition) return identifier(target.taskDefinition);
  const response = parsed(await run('aws', ['ecs', 'describe-services', '--cluster', identifier(target.cluster),
    '--services', identifier(target.service!), '--region', identifier(target.region), '--output', 'json']));
  const services = list(response.services).map(record);
  if (services.length !== 1 || list(response.failures ?? []).length) throw new Error('automation_cloud_target_invalid');
  return identifier(string(services[0]!.taskDefinition));
}

async function describeCloudTarget(
  target: CloudTarget,
  run: CloudCommandRunner,
  requireStartup: boolean,
): Promise<CloudTargetInspection> {
  if (target.provider === 'GOOGLE_CLOUD') {
    const project = identifier(target.project);
    const region = identifier(target.region);
    if (!!target.job === !!target.service) throw new Error('automation_cloud_target_invalid');
    const resource = target.service ? 'services' : 'jobs';
    const name = identifier(target.service ?? target.job!);
    const data = parsed(await run('gcloud', ['run', resource, 'describe', name, '--project', project, '--region', region, '--format=json']));
    const templateSpec = record(record(data.spec).template);
    const podSpec = target.service ? record(templateSpec.spec) : record(record(templateSpec.spec).template).spec;
    const runtimeSpec = record(podSpec);
    const container = selectContainer(runtimeSpec.containers, target.container);
    const original = [...command(container.command ?? []), ...command(container.args ?? [])];
    if (requireStartup && !command(container.command ?? []).length) {
      throw new Error('automation_cloud_startup_unknown');
    }
    const identity = string(runtimeSpec.serviceAccountName);
    const numericId = (await run('gcloud', [
      'iam', 'service-accounts', 'describe', identity,
      '--project', project, '--format=value(uniqueId)',
    ])).trim();
    if (!/^\d+$/.test(numericId)) throw new Error('automation_cloud_identity_invalid');
    const metadata = record(data.metadata);
    const containerName = container.name === undefined ? '' : string(container.name);
    return { target, image: string(container.image), container: containerName, command: original,
      environmentNames: names(container.env), identity, identityNumericId: numericId,
      revision: String(metadata.generation ?? metadata.uid ?? '') };
  }
  if (target.provider === 'AWS') {
    const region = identifier(target.region);
    const taskDefinition = await resolveEcsTaskDefinition(target, run);
    const response = parsed(await run('aws', [
      'ecs', 'describe-task-definition', '--task-definition', taskDefinition,
      '--region', region, '--output', 'json',
    ]));
    const definition = record(response.taskDefinition);
    const container = selectContainer(definition.containerDefinitions, target.container);
    const entryPoint = command(container.entryPoint ?? []);
    if (requireStartup && !entryPoint.length) throw new Error('automation_cloud_startup_unknown');
    const original = [...entryPoint, ...command(container.command ?? [])];
    return { target, image: string(container.image), container: string(container.name), command: original,
      environmentNames: names(container.environment), identity: string(definition.taskRoleArn),
      revision: string(definition.taskDefinitionArn) };
  }
  throw new Error('automation_cloud_target_invalid');
}

export async function inspectCloudTarget(
  target: CloudTarget,
  run: CloudCommandRunner = runCloudCommand,
): Promise<CloudTargetInspection> {
  return describeCloudTarget(target, run, true);
}

export async function inspectCloudTargetForPairing(
  target: CloudTarget,
  run: CloudCommandRunner = runCloudCommand,
): Promise<CloudTargetInspection> {
  return describeCloudTarget(target, run, false);
}

/** Pin the image actually running in the selected ECS service container. */
export async function runningEcsServiceImage(
  inspected: CloudTargetInspection,
  run: CloudCommandRunner = runCloudCommand,
): Promise<string> {
  const target = inspected.target;
  if (target.provider !== 'AWS' || !target.service) throw new Error('automation_cloud_target_invalid');
  const source = inspected.image;
  const digestSeparator = source.indexOf('@');
  const tagSeparator = source.lastIndexOf(':');
  const repository = digestSeparator >= 0 ? source.slice(0, digestSeparator)
    : tagSeparator > source.lastIndexOf('/') ? source.slice(0, tagSeparator) : source;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(repository) ||
      (digestSeparator >= 0 && !/^sha256:[a-f0-9]{64}$/i.test(source.slice(digestSeparator + 1))) ||
      (digestSeparator < 0 && tagSeparator > source.lastIndexOf('/') &&
        !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(source.slice(tagSeparator + 1))))
    throw new Error('automation_image_digest_required');
  const digests = new Set<string>();
  let matched = 0;
  const listed = parsed(await run('aws', ['ecs', 'list-tasks', '--cluster', identifier(target.cluster),
    '--service-name', identifier(target.service), '--desired-status', 'RUNNING', '--region', identifier(target.region),
    '--output', 'json']));
  const arns = list(listed.taskArns).map(item => identifier(string(item)));
    for (let offset = 0; offset < arns.length; offset += 100) {
      const described = parsed(await run('aws', ['ecs', 'describe-tasks', '--cluster', identifier(target.cluster),
        '--tasks', ...arns.slice(offset, offset + 100), '--region', identifier(target.region), '--output', 'json']));
      if (list(described.failures ?? []).length) throw new Error('automation_ecs_running_image_unavailable');
      for (const task of list(described.tasks).map(record)) {
        if (task.taskDefinitionArn !== inspected.revision || task.lastStatus !== 'RUNNING' || task.healthStatus === 'UNHEALTHY') continue;
        matched++;
        const container = list(task.containers).map(record).find(item => item.name === inspected.container);
        if (container?.lastStatus !== undefined && container.lastStatus !== 'RUNNING')
          throw new Error('automation_ecs_running_image_unavailable');
        const digest = container?.imageDigest;
        if (typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(digest))
          throw new Error('automation_ecs_running_image_unavailable');
        digests.add(digest.toLowerCase());
      }
    }
  if (!matched || digests.size !== 1) throw new Error('automation_ecs_running_image_unavailable');
  const digest = [...digests][0]!;
  if (source.includes('@') && source !== `${repository}@${digest}`)
    throw new Error('automation_ecs_running_image_unavailable');
  return `${repository}@${digest}`;
}

export async function inspectCloudIdentity(
  target: CloudTarget,
  run: CloudCommandRunner = runCloudCommand,
): Promise<{ identity: string; identityNumericId?: string }> {
  const { identity, identityNumericId } = await describeCloudTarget(target, run, false);
  return identityNumericId ? { identity, identityNumericId } : { identity };
}

export function previewCloudTarget(
  inspected: CloudTargetInspection,
  scriptPath: string,
  addedEnvironmentNames: string[],
): CloudTargetPreview {
  if (!scriptPath.startsWith('/') || /[\x00-\x1f\x7f]/.test(scriptPath) || !inspected.command.length ||
      addedEnvironmentNames.some(name => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) throw new Error('automation_cloud_preview_invalid');
  return { target: inspected.target, image: inspected.image, identity: inspected.identity,
    revision: inspected.revision, startupCommandWillChange: true, proposedLauncherPath: scriptPath,
    addedEnvironmentNames: [...addedEnvironmentNames] };
}
