import {
  applyCloudRunAutomation,
  applyCloudRunServiceAutomation,
  applyEcsAutomation,
} from '@safetech/inheriti-elements-core/node-base';
import type {
  AutomationProvider,
  AutomationTrust,
  CloudTarget,
} from '@safetech/inheriti-elements-core/node-base';

type Options = Record<string, string>;
type Inspection = { identity: string; identityNumericId?: string };
type ApplyInput = {
  target: CloudTarget;
  expectedRevision: string;
  planId: string;
  mappings: ReadonlyArray<{ selector: string; envName: string }>;
  image: string;
  cliPath: string;
  environment: Record<string, string>;
};

const commonFlags = ['--id', '--name', '--provider', '--deployment-environment'];

abstract class CliAutomationProvider {
  abstract readonly value: AutomationProvider;
  abstract readonly createFlags: readonly string[];
  abstract trust(options: Options, id: string): AutomationTrust | undefined;

  target(_options: Options): CloudTarget | undefined { return undefined; }
  inspectedTrust(_inspection: Inspection): Options { return {}; }
  async apply(_input: ApplyInput, _trust: AutomationTrust, _identity: string): Promise<{ status: string }> {
    throw new Error('automation_runtime_provider_unsupported');
  }
}

class GithubProvider extends CliAutomationProvider {
  readonly value = 'GITHUB';
  readonly createFlags = [...commonFlags, '--repository', '--environment', '--workflow'];

  trust(options: Options): AutomationTrust | undefined {
    if (!options['--repository'] || !options['--environment'] || !options['--workflow']) return;
    return { method: 'GITHUB_ACTIONS_OIDC', repositoryName: options['--repository'],
      environment: options['--environment'], workflow: options['--workflow'] };
  }
}

class GoogleCloudProvider extends CliAutomationProvider {
  readonly value = 'GOOGLE_CLOUD';
  readonly createFlags = [...commonFlags, '--audience-base', '--subject', '--project', '--region', '--job', '--service', '--container'];

  trust(options: Options, id: string): AutomationTrust | undefined {
    if (!options['--audience-base'] || !options['--subject']) return;
    return { method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC',
      audience: `${options['--audience-base'].replace(/\/+$/, '')}/${id}`,
      serviceAccountSubject: options['--subject'] };
  }

  override target(options: Options): CloudTarget | undefined {
    if (!options['--project'] || !options['--region'] ||
        !!options['--job'] === !!options['--service'] || options['--cluster'] || options['--task-definition']) return;
    if (options['--service']) return { provider: this.value, project: options['--project'], region: options['--region'],
      service: options['--service'], ...(options['--container'] ? { container: options['--container'] } : {}) };
    return { provider: this.value, project: options['--project'], region: options['--region'],
      job: options['--job']!, ...(options['--container'] ? { container: options['--container'] } : {}) };
  }

  override inspectedTrust(inspection: Inspection): Options {
    return inspection.identityNumericId ? { '--subject': inspection.identityNumericId } : {};
  }

  override async apply(input: ApplyInput, _trust: AutomationTrust, identity: string) {
    if (input.target.provider !== this.value) throw new Error('automation_runtime_provider_invalid');
    if (input.target.service) return applyCloudRunServiceAutomation({ ...input,
      target: { ...input.target, service: input.target.service }, expectedServiceAccount: identity });
    return applyCloudRunAutomation({ ...input, target: input.target, expectedServiceAccount: identity });
  }
}

class AwsProvider extends CliAutomationProvider {
  readonly value = 'AWS';
  readonly createFlags = [...commonFlags, '--role-arn', '--region', '--cluster', '--service', '--task-definition', '--container', '--instance'];

  trust(options: Options): AutomationTrust | undefined {
    if (!options['--role-arn']) return;
    return { method: 'AWS_IAM_ROLE', roleArn: options['--role-arn'] };
  }

  override target(options: Options): CloudTarget | undefined {
    if (!options['--region'] || !options['--cluster'] ||
        !!options['--service'] === !!options['--task-definition'] ||
        options['--project'] || options['--job']) return;
    const shared = { provider: 'AWS' as const, region: options['--region'], cluster: options['--cluster'],
      ...(options['--container'] ? { container: options['--container'] } : {}) };
    if (options['--service']) return { ...shared, service: options['--service'] };
    return { ...shared, taskDefinition: options['--task-definition']! };
  }

  override inspectedTrust(inspection: Inspection): Options {
    return inspection.identity ? { '--role-arn': inspection.identity } : {};
  }

  override async apply(input: ApplyInput, trust: AutomationTrust) {
    if (input.target.provider !== this.value || !('service' in input.target) || trust.method !== 'AWS_IAM_ROLE') {
      throw new Error('automation_runtime_provider_invalid');
    }
    return applyEcsAutomation({ ...input, target: { ...input.target, service: input.target.service }, expectedRoleArn: trust.roleArn });
  }
}

class PortableProvider extends CliAutomationProvider {
  readonly value = 'PORTABLE';
  readonly createFlags = [...commonFlags, '--key-id', '--public-key', '--subject', '--environment'];

  trust(options: Options): AutomationTrust | undefined {
    if (!options['--key-id'] || !options['--public-key'] || !options['--subject'] || !options['--environment']) return;
    return { method: 'PORTABLE_SIGNED_ASSERTION', keyId: options['--key-id'],
      publicKey: options['--public-key'], runnerSubject: options['--subject'],
      environment: options['--environment'] };
  }
}

const providers = {
  GITHUB: new GithubProvider(),
  GOOGLE_CLOUD: new GoogleCloudProvider(),
  AWS: new AwsProvider(),
  PORTABLE: new PortableProvider(),
} satisfies Record<AutomationProvider, CliAutomationProvider>;

export function cliAutomationProvider(value: unknown): CliAutomationProvider | undefined {
  if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(providers, value)) return;
  return providers[value as AutomationProvider];
}
