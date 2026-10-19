import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export type EcsPairInput = {
  target: { provider: 'AWS'; region: string; cluster: string; service: string; container?: string };
  expectedRevision: string;
  expectedRoleArn: string;
  image: string;
  cliPath: string;
  environment: Readonly<Record<string, string>>;
  startPairing: () => Promise<void>;
  signal?: AbortSignal;
};
export type EcsPairResult = { taskArn: string; taskDefinitionArn: string; status: 'paired' };
export type EcsPairRunner = (args: string[], signal?: AbortSignal) => Promise<string>;
const runAws: EcsPairRunner = async (args, signal) => {
  try {
    const { stdout } = await execFileAsync('aws', args, {
      maxBuffer: 4 * 1024 * 1024, timeout: args[1] === 'wait' ? 720_000 : 120_000, windowsHide: true, signal,
    });
    return stdout;
  } catch {
    throw new Error('automation_ecs_pair_provider_failed');
  }
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('automation_ecs_pair_response_invalid');
  return value as Record<string, unknown>;
};
const items = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error('automation_ecs_pair_response_invalid');
  return value;
};
const parsed = (value: string): Record<string, unknown> => {
  try { return record(JSON.parse(value)); } catch { throw new Error('automation_ecs_pair_response_invalid'); }
};
const name = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,255}$/.test(value);
const role = (value: unknown): value is string =>
  typeof value === 'string' && /^arn:aws(?:-[a-z]+)?:iam::\d{12}:role\/[a-zA-Z0-9+=,.@_/-]+$/.test(value);
const imageDigest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64}$/i.test(value);
const inputValid = (input: EcsPairInput): boolean =>
  input.target.provider === 'AWS' && name(input.target.region) && name(input.target.cluster) &&
  name(input.target.service) && (!input.target.container || name(input.target.container)) &&
  name(input.expectedRevision) && role(input.expectedRoleArn) && imageDigest(input.image) &&
  input.cliPath.startsWith('/') && !/[\x00-\x1f\x7f]/.test(input.cliPath) &&
  typeof input.startPairing === 'function' &&
  input.environment.INHERITI_AUTOMATION_PROVIDER === 'AWS' &&
  input.environment.AWS_REGION === input.target.region &&
  !!input.environment.INHERITI_AUTOMATION_CONNECTION_ID &&
  Object.entries(input.environment).every(([key, value]) =>
    ['AWS_REGION', 'INHERITI_AUTOMATION_PROVIDER', 'INHERITI_AUTOMATION_CONNECTION_ID'].includes(key) &&
    typeof value === 'string' && !!value && !/[\x00-\x1f\x7f]/.test(value));

/** Runs a single native-identity proof in the service's task role without changing the service. */
export async function pairEcsAutomation(input: EcsPairInput, run: EcsPairRunner = runAws): Promise<EcsPairResult> {
  if (!inputValid(input)) throw new Error('automation_ecs_pair_input_invalid');
  const { target } = input;
  input.signal?.throwIfAborted();
  const region = ['--region', target.region, '--output', 'json'];
  const call = async (args: string[], signal?: AbortSignal): Promise<Record<string, unknown>> =>
    parsed(await run(['ecs', ...args, ...region], signal));
  const response = await call(['describe-services', '--cluster', target.cluster, '--services', target.service], input.signal);
  const services = items(response.services).map(record);
  if (services.length !== 1 || items(response.failures ?? []).length) throw new Error('automation_ecs_pair_service_invalid');
  const service = services[0]!;
  if (service.status !== 'ACTIVE' || record(service.deploymentController).type !== 'ECS' ||
      service.taskDefinition !== input.expectedRevision) throw new Error('automation_ecs_pair_service_invalid');
  const definition = record((await call(['describe-task-definition', '--task-definition', input.expectedRevision], input.signal)).taskDefinition);
  if (definition.taskDefinitionArn !== input.expectedRevision || definition.taskRoleArn !== input.expectedRoleArn)
    throw new Error('automation_ecs_pair_identity_changed');
  const containers = items(definition.containerDefinitions).map(record);
  const selected = containers.filter(container => target.container ? container.name === target.container : true);
  if (selected.length !== 1 || !name(selected[0]!.name)) throw new Error('automation_ecs_pair_container_ambiguous');
  const launchType = service.launchType;
  const capacity = service.capacityProviderStrategy;
  if (!!launchType === !!(Array.isArray(capacity) && capacity.length)) throw new Error('automation_ecs_pair_placement_unknown');
  if (launchType && !['EC2', 'FARGATE', 'EXTERNAL', 'MANAGED_INSTANCES'].includes(String(launchType)))
    throw new Error('automation_ecs_pair_placement_unknown');
  const network = definition.networkMode === 'awsvpc' ? service.networkConfiguration : undefined;
  if (definition.networkMode === 'awsvpc' && (!network || !record(network).awsvpcConfiguration))
    throw new Error('automation_ecs_pair_network_unknown');
  const registration = {
    family: `inheriti-pair-${randomUUID()}`,
    taskRoleArn: definition.taskRoleArn,
    ...(definition.executionRoleArn ? { executionRoleArn: definition.executionRoleArn } : {}),
    ...(definition.networkMode ? { networkMode: definition.networkMode } : {}),
    ...(definition.requiresCompatibilities ? { requiresCompatibilities: definition.requiresCompatibilities } : {}),
    ...(definition.cpu ? { cpu: definition.cpu } : {}),
    ...(definition.memory ? { memory: definition.memory } : {}),
    ...(definition.runtimePlatform ? { runtimePlatform: definition.runtimePlatform } : {}),
    containerDefinitions: [{ name: selected[0]!.name, image: input.image, essential: true,
      ...(selected[0]!.memory !== undefined ? { memory: selected[0]!.memory } : {}),
      ...(selected[0]!.memoryReservation !== undefined ? { memoryReservation: selected[0]!.memoryReservation } : {}),
      entryPoint: [input.cliPath], command: ['automations', 'pair', 'redeem'],
      environment: Object.entries(input.environment).map(([key, value]) => ({ name: key, value })) }],
  };
  const request = {
    cluster: target.cluster,
    taskDefinition: '',
    count: 1,
    ...(launchType ? { launchType } : { capacityProviderStrategy: capacity }),
    ...(network ? { networkConfiguration: network } : {}),
    ...(service.platformVersion ? { platformVersion: service.platformVersion } : {}),
  };
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-ecs-pair-'));
  const registrationFile = join(directory, 'task-definition.json');
  const requestFile = join(directory, 'run-task.json');
  try {
    await writeFile(registrationFile, JSON.stringify(registration), { mode: 0o600, flag: 'wx' });
    const registered = await call(['register-task-definition', '--cli-input-json', `file://${registrationFile}`]);
    const taskDefinitionArn = record(registered.taskDefinition).taskDefinitionArn;
    if (!name(taskDefinitionArn)) throw new Error('automation_ecs_pair_registration_invalid');
    try {
      await writeFile(requestFile, JSON.stringify({ ...request, taskDefinition: taskDefinitionArn }), { mode: 0o600, flag: 'wx' });
      input.signal?.throwIfAborted();
      try { await input.startPairing(); } catch { throw new Error('automation_ecs_pair_window_failed'); }
      input.signal?.throwIfAborted();
      // Let run-task return its ARN even if cancellation arrives during launch, so the task can be stopped.
      const started = await call(['run-task', '--cli-input-json', `file://${requestFile}`], undefined);
      const tasks = items(started.tasks).map(record);
      if (items(started.failures ?? []).length || tasks.length !== 1 || !name(tasks[0]!.taskArn))
        throw new Error('automation_ecs_pair_start_failed');
      const taskArn = tasks[0]!.taskArn as string;
      try {
        input.signal?.throwIfAborted();
        await run(['ecs', 'wait', 'tasks-stopped', '--cluster', target.cluster, '--tasks', taskArn, '--region', target.region], input.signal);
      } catch {
        try { await call(['stop-task', '--cluster', target.cluster, '--task', taskArn, '--reason', 'Pairing did not complete'], undefined); }
        catch { throw new Error('automation_ecs_pair_stop_failed'); }
        throw new Error('automation_ecs_pair_wait_failed');
      }
      const finished = await call(['describe-tasks', '--cluster', target.cluster, '--tasks', taskArn], input.signal);
      const completed = items(finished.tasks).map(record);
      const finalContainers = completed.length === 1 ? items(completed[0]!.containers).map(record) : [];
      if (items(finished.failures ?? []).length || completed[0]?.lastStatus !== 'STOPPED' ||
          finalContainers.length !== 1 || finalContainers[0]!.name !== selected[0]!.name ||
          finalContainers[0]!.exitCode !== 0) throw new Error('automation_ecs_pair_failed');
      return { taskArn, taskDefinitionArn, status: 'paired' };
    } finally {
      await call(['deregister-task-definition', '--task-definition', taskDefinitionArn], undefined);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
