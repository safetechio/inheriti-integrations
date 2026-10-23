import { isGithubAutomationSelector } from './automation-setup.js';
import type { AutomationConnection } from './automation-setup.js';
import { AutomationProviderValue } from './automation-provider.js';

export type AutomationRuntimeInput = {
  planId: string;
  connection: AutomationConnection;
  mappings?: ReadonlyArray<{ selector: string; envName: string }>;
  selector?: string;
  envName?: string;
};

export type AutomationRuntimeBundle = {
  provider: 'GOOGLE_CLOUD' | 'AWS' | 'PORTABLE';
  target: 'Cloud Run workload' | 'ECS task' | 'Custom runner';
  script: string;
  environment: Record<string, string>;
  requiredEnvironment: string[];
  instructions: string[];
};

const UUID = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

type RuntimePolicy = Pick<AutomationRuntimeBundle, 'provider' | 'target' | 'environment' | 'requiredEnvironment' | 'instructions'>;

function runtimePolicy(connection: AutomationConnection): RuntimePolicy {
  const provider = AutomationProviderValue.from(connection.provider);
  if (!provider.accepts(connection.trust) || provider.value === 'GITHUB') throw new Error('automation_runtime_provider_invalid');
  const environment = {
    INHERITI_AUTOMATION_PROVIDER: provider.value,
    INHERITI_AUTOMATION_CONNECTION_ID: connection.id,
  };
  if (connection.trust.method === 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC') {
    if (!connection.trust.audience || !connection.trust.audience.endsWith(`/${connection.id}`)) {
      throw new Error('automation_runtime_trust_invalid');
    }
    return {
      provider: 'GOOGLE_CLOUD',
      target: 'Cloud Run workload',
      environment: { ...environment, INHERITI_AUTOMATION_AUDIENCE: connection.trust.audience },
      requiredEnvironment: [],
      instructions: [
        'Attach the configured service account to the Cloud Run service or job.',
        'Include the Inheriti CLI and this script in the container image. Set the container command to this script and its arguments to the original application command and arguments.',
        'Start the workload to confirm the connection, plan access, and application startup.',
      ],
    };
  }
  if (connection.trust.method === 'AWS_IAM_ROLE') {
    if (!/^arn:aws(?:-[a-z]+)?:iam::\d{12}:role\/.+/.test(connection.trust.roleArn)) throw new Error('automation_runtime_trust_invalid');
    return {
      provider: 'AWS',
      target: 'ECS task',
      environment,
      requiredEnvironment: ['AWS_REGION or AWS_DEFAULT_REGION'],
      instructions: [
        'Set the configured IAM role as taskRoleArn, not executionRoleArn, in the ECS task definition.',
        'Include the Inheriti CLI and this script in the container image. ' +
          'Set the task entry point to this script and the task command to the original application command and arguments.',
        'Provide AWS_REGION or AWS_DEFAULT_REGION in the task environment and run the task once to confirm the connection, plan access, and application startup.',
      ],
    };
  }
  if (connection.trust.method === 'PORTABLE_SIGNED_ASSERTION') {
    const identityValues = [
      connection.trust.keyId,
      connection.trust.runnerSubject,
      connection.trust.environment,
    ];
    if (identityValues.some(value => !value || /[\x00-\x1f\x7f]/.test(value))) {
      throw new Error('automation_runtime_trust_invalid');
    }
    return {
      provider: 'PORTABLE',
      target: 'Custom runner',
      environment: {
        ...environment,
        INHERITI_AUTOMATION_KEY_ID: connection.trust.keyId,
        INHERITI_AUTOMATION_RUNNER_SUBJECT: connection.trust.runnerSubject,
        INHERITI_AUTOMATION_ENVIRONMENT: connection.trust.environment,
      },
      requiredEnvironment: ['INHERITI_AUTOMATION_PRIVATE_KEY_FILE'],
      instructions: [
        'Keep the private key on the runner; mount it as a restricted file and set INHERITI_AUTOMATION_PRIVATE_KEY_FILE to its path.',
        'Install the Inheriti CLI and this script on the runner. Configure its service or job launcher to pass the original application command and arguments to this script.',
        'Run the launcher once to confirm the connection, plan access, and application startup.',
      ],
    };
  }
  throw new Error('automation_runtime_provider_invalid');
}

export function generateAutomationRuntimeBundle(input: AutomationRuntimeInput): AutomationRuntimeBundle {
  const { planId, connection } = input;
  const mappings = input.mappings ?? (input.selector && input.envName ? [{ selector: input.selector, envName: input.envName }] : []);
  const names = mappings.map(mapping => mapping.envName);
  if (!UUID.test(planId) || !UUID.test(connection.id) || !mappings.length ||
      new Set(names).size !== names.length || mappings.some(({ selector, envName }) =>
        !isGithubAutomationSelector(selector) || !ENV_NAME.test(envName) || envName.startsWith('INHERITI_AUTOMATION_'))) {
    throw new Error('automation_runtime_input_invalid');
  }
  const policy = runtimePolicy(connection);
  const cli = ['inheriti', 'secrets', 'exec', planId, '--automation',
    ...mappings.flatMap(({ envName, selector }) => ['--env', `${envName}=${selector}`]), '--'];
  const script = [
    '#!/bin/sh',
    'set -eu',
    ...Object.entries(policy.environment).map(([name, value]) => `export ${name}=${shellQuote(value)}`),
    '[ "$#" -gt 0 ] || { echo \'Application command required\' >&2; exit 2; }',
    `exec ${cli.map(shellQuote).join(' ')} "$@"`,
    '',
  ].join('\n');
  return { ...policy, script };
}
