import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { CloudTarget } from './automation-cloud-target.js';
import { isGithubAutomationSelector } from './automation-setup.js';

const execFileAsync = promisify(execFile);
type EcsTarget = Extract<CloudTarget, { provider: 'AWS' }> & { service: string };
export type EcsApplyInput = {
  target: EcsTarget;
  expectedRevision: string;
  expectedRoleArn: string;
  planId: string;
  selector?: string;
  envName?: string;
  mappings?: ReadonlyArray<{ selector: string; envName: string }>;
  image: string;
  cliPath: string;
  environment: Record<string, string>;
};
export type EcsApplyResult = { previousRevision: string; revision: string; image: string; status: 'unchanged' | 'deployed' };
export type EcsApplyRunner = (args: string[]) => Promise<string>;
const runAws: EcsApplyRunner = async args => {
  try {
    const { stdout } = await execFileAsync('aws', args, { maxBuffer: 4 * 1024 * 1024, timeout: args[1] === 'wait' ? 1_200_000 : 120_000, windowsHide: true });
    return stdout;
  } catch {
    throw new Error('automation_ecs_provider_failed');
  }
};
const valid = (value: unknown): value is string => typeof value === 'string' && !!value && !/[\x00-\x1f\x7f]/.test(value);
const identifier = (value: unknown): value is string => valid(value) && /^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,255}$/.test(value);
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('automation_ecs_response_invalid');
  return value as Record<string, unknown>;
};
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error('automation_ecs_response_invalid');
  return value;
};
const parse = (value: string): Record<string, unknown> => {
  try { return object(JSON.parse(value)); } catch { throw new Error('automation_ecs_response_invalid'); }
};
const strings = (value: unknown): string[] => {
  const items = array(value);
  if (!items.every(valid)) throw new Error('automation_ecs_response_invalid');
  return items as string[];
};
const TASK_FIELDS = [
  'family', 'taskRoleArn', 'executionRoleArn', 'networkMode', 'containerDefinitions', 'volumes',
  'placementConstraints', 'requiresCompatibilities', 'cpu', 'memory', 'tags', 'pidMode', 'ipcMode',
  'proxyConfiguration', 'inferenceAccelerators', 'ephemeralStorage', 'runtimePlatform', 'enableFaultInjection',
] as const;
const mappingsFor = (input: EcsApplyInput) => input.mappings ??
  (input.selector && input.envName ? [{ selector: input.selector, envName: input.envName }] : []);
const inputIsValid = (input: EcsApplyInput): boolean => {
  const { target, expectedRevision, expectedRoleArn, planId, image, cliPath, environment } = input;
  const mappings = mappingsFor(input);
  const names = mappings.map(mapping => mapping.envName);
  return target.provider === 'AWS' && identifier(target.region) && identifier(target.cluster) && identifier(target.service) &&
    !target.taskDefinition && (!target.container || identifier(target.container)) && identifier(expectedRevision) &&
    /^arn:aws(?:-[a-z]+)?:iam::\d{12}:role\/.+/.test(expectedRoleArn) &&
    /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(planId) && mappings.length > 0 &&
    new Set(names).size === names.length && mappings.every(({ selector, envName }) =>
      isGithubAutomationSelector(selector) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(envName) &&
      !envName.startsWith('INHERITI_AUTOMATION_')) &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64}$/i.test(image) && cliPath.startsWith('/') && valid(cliPath) &&
    Object.entries(environment).every(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && valid(value) && !names.includes(key));
};

export async function applyEcsAutomation(input: EcsApplyInput, run: EcsApplyRunner = runAws): Promise<EcsApplyResult> {
  if (!inputIsValid(input)) throw new Error('automation_ecs_input_invalid');
  const mappings = mappingsFor(input);
  const mappedNames = mappings.map(mapping => mapping.envName);
  const { target } = input;
  const region = ['--region', target.region, '--output', 'json'];
  const call = async (args: string[]): Promise<Record<string, unknown>> => parse(await run(['ecs', ...args, ...region]));
  const describeService = async (): Promise<Record<string, unknown>> => {
    const response = await call(['describe-services', '--cluster', target.cluster, '--services', target.service]);
    const services = array(response.services).map(object);
    if (services.length !== 1 || array(response.failures ?? []).length) throw new Error('automation_ecs_service_invalid');
    return services[0]!;
  };
  const service = await describeService();
  if (service.status !== 'ACTIVE' || object(service.deploymentController).type !== 'ECS' ||
      !identifier(service.taskDefinition)) throw new Error('automation_ecs_service_invalid');
  const previousRevision = service.taskDefinition;
  if (previousRevision !== input.expectedRevision) throw new Error('automation_ecs_revision_changed');
  const described = await call(['describe-task-definition', '--task-definition', previousRevision, '--include', 'TAGS']);
  const definition = object(described.taskDefinition);
  if (definition.taskDefinitionArn !== previousRevision || definition.taskRoleArn !== input.expectedRoleArn) {
    throw new Error('automation_ecs_identity_changed');
  }
  const containers = array(definition.containerDefinitions).map(object);
  const matching = containers.filter(container => target.container ? container.name === target.container : true);
  if (matching.length !== 1) throw new Error('automation_ecs_container_ambiguous');
  const container = matching[0]!;
  if (!valid(container.name) || !valid(container.image)) throw new Error('automation_ecs_response_invalid');
  const entryPoint = container.entryPoint === undefined ? [] : strings(container.entryPoint);
  if (!entryPoint.length) throw new Error('automation_ecs_startup_unknown');
  const environment = array(container.environment ?? []).map(object);
  const nativeSecretNames = strings(array(container.secrets ?? []).map(item => object(item).name));
  const environmentNames = strings(environment.map(item => item.name));
  if (new Set(environmentNames).size !== environmentNames.length ||
      nativeSecretNames.some(name => mappedNames.includes(name) || Object.hasOwn(input.environment, name))) {
    throw new Error('automation_ecs_environment_conflict');
  }
  const addedEnvironment = Object.entries(input.environment).map(([name, value]) => ({ name, value }));
  if (addedEnvironment.some(item => environment.some(existing => existing.name === item.name && existing.value !== item.value))) {
    throw new Error('automation_ecs_environment_conflict');
  }
  const prefix = [input.cliPath, 'secrets', 'exec', input.planId, '--automation',
    ...mappings.flatMap(({ envName, selector }) => ['--env', `${envName}=${selector}`]), '--'];
  const alreadyWrapped = entryPoint[0] === input.cliPath && entryPoint[1] === 'secrets' && entryPoint[2] === 'exec';
  if (alreadyWrapped) {
    if (environmentNames.some(name => mappedNames.includes(name))) throw new Error('automation_ecs_environment_conflict');
    if (entryPoint.slice(0, prefix.length).join('\0') !== prefix.join('\0') ||
        addedEnvironment.some(item => !environment.some(existing => existing.name === item.name && existing.value === item.value))) {
      throw new Error('automation_ecs_existing_setup_conflict');
    }
    if (container.image === input.image) return { previousRevision, revision: previousRevision, image: input.image, status: 'unchanged' };
  }
  if (environmentNames.some(name => mappedNames.includes(name))) throw new Error('automation_ecs_environment_conflict');
  const updatedContainer = { ...container, image: input.image, entryPoint: alreadyWrapped ? entryPoint : [...prefix, ...entryPoint],
    environment: [...environment, ...addedEnvironment.filter(item => !environment.some(existing => existing.name === item.name))] };
  const registration: Record<string, unknown> = {};
  for (const field of TASK_FIELDS) {
    const value = field === 'tags' ? described.tags : definition[field];
    if (value !== undefined) registration[field] = value;
  }
  registration.containerDefinitions = containers.map(item => item === container ? updatedContainer : item);
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-ecs-'));
  const file = join(directory, 'task-definition.json');
  try {
    await writeFile(file, JSON.stringify(registration), { mode: 0o600, flag: 'wx' });
    const registered = await call(['register-task-definition', '--cli-input-json', `file://${file}`]);
    const nextRevision = object(registered.taskDefinition).taskDefinitionArn;
    if (!identifier(nextRevision) || nextRevision === previousRevision) throw new Error('automation_ecs_registration_invalid');
    const beforeUpdate = await describeService();
    if (beforeUpdate.taskDefinition !== previousRevision) throw new Error('automation_ecs_revision_changed');
    try {
      await call(['update-service', '--cluster', target.cluster, '--service', target.service, '--task-definition', nextRevision]);
      await run(['ecs', 'wait', 'services-stable', '--cluster', target.cluster, '--services', target.service, '--region', target.region]);
      const deployed = await describeService();
      const deployments = array(deployed.deployments).map(object);
      if (deployed.status !== 'ACTIVE' || deployed.taskDefinition !== nextRevision || deployments.length !== 1 ||
          deployments[0]!.taskDefinition !== nextRevision || deployments[0]!.status !== 'PRIMARY' ||
          (deployments[0]!.rolloutState !== undefined && deployments[0]!.rolloutState !== 'COMPLETED') ||
          typeof deployed.desiredCount !== 'number' || deployed.desiredCount < 1 ||
          deployed.runningCount !== deployed.desiredCount || deployed.pendingCount !== 0) {
        throw new Error('automation_ecs_deployment_unstable');
      }
    } catch {
      try {
        const current = await describeService();
        if (current.taskDefinition === previousRevision) throw new Error('automation_ecs_deployment_failed');
        if (current.taskDefinition !== nextRevision) throw new Error('automation_ecs_revision_changed');
        await call(['update-service', '--cluster', target.cluster, '--service', target.service, '--task-definition', previousRevision]);
        await run(['ecs', 'wait', 'services-stable', '--cluster', target.cluster, '--services', target.service, '--region', target.region]);
        const restored = await describeService();
        const restoredDeployments = array(restored.deployments).map(object);
        if (restored.status !== 'ACTIVE' || restored.taskDefinition !== previousRevision ||
            restoredDeployments.length !== 1 || restoredDeployments[0]!.taskDefinition !== previousRevision ||
            restoredDeployments[0]!.status !== 'PRIMARY' ||
            (restoredDeployments[0]!.rolloutState !== undefined && restoredDeployments[0]!.rolloutState !== 'COMPLETED') ||
            typeof restored.desiredCount !== 'number' || restored.desiredCount < 1 ||
            restored.runningCount !== restored.desiredCount || restored.pendingCount !== 0)
          throw new Error('automation_ecs_rollback_unconfirmed');
      } catch (error) {
        if (error instanceof Error && (error.message === 'automation_ecs_revision_changed' ||
            error.message === 'automation_ecs_deployment_failed' || error.message === 'automation_ecs_rollback_unconfirmed')) throw error;
        throw new Error('automation_ecs_rollback_failed');
      }
      throw new Error('automation_ecs_deployment_failed');
    }
    return { previousRevision, revision: nextRevision, image: input.image, status: 'deployed' };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
