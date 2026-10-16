import {
  applyCloudRunAutomation,
  applyCloudRunServiceAutomation,
  applyEcsAutomation,
} from '@safetech/inheriti-elements-core/node-base';
import type {
  AutomationConnection,
  CloudTarget,
  CloudTargetInspection,
  CloudTargetPreview,
  CloudRunAutomationResult,
  EcsApplyResult,
} from '@safetech/inheriti-elements-core/node-base';
import { coded } from './errors.js';

type ApplyInput = {
  target: CloudTarget;
  expectedRevision: string;
  planId: string;
  mappings: ReadonlyArray<{ selector: string; envName: string }>;
  image: string;
  cliPath: string;
  environment: Record<string, string>;
};

interface RuntimeProvider {
  readonly cloud: boolean;
  accepts(target: CloudTarget): boolean;
  assertIdentity(connection: AutomationConnection, inspected: CloudTargetInspection): void;
  apply(input: ApplyInput, connection: AutomationConnection, preview: CloudTargetPreview): Promise<CloudRunAutomationResult | EcsApplyResult>;
}

class PortableRuntimeProvider implements RuntimeProvider {
  readonly cloud = false;
  accepts(): boolean { return false; }
  assertIdentity(): void { throw coded('automation_cloud_target_invalid'); }
  apply(): Promise<never> { throw coded('automation_cloud_target_invalid'); }
}

class GoogleCloudRuntimeProvider implements RuntimeProvider {
  readonly cloud = true;
  accepts(target: CloudTarget): boolean { return target.provider === 'GOOGLE_CLOUD'; }
  assertIdentity(connection: AutomationConnection, inspected: CloudTargetInspection): void {
    if (connection.trust.method !== 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC' ||
        inspected.identityNumericId !== connection.trust.serviceAccountSubject)
      throw coded('automation_cloud_identity_mismatch');
  }
  apply(input: ApplyInput, _connection: AutomationConnection, preview: CloudTargetPreview) {
    if (input.target.provider !== 'GOOGLE_CLOUD') throw coded('automation_cloud_target_invalid');
    if (input.target.service) return applyCloudRunServiceAutomation({ ...input,
      target: { ...input.target, service: input.target.service }, expectedServiceAccount: preview.identity });
    return applyCloudRunAutomation({ ...input, target: input.target, expectedServiceAccount: preview.identity });
  }
}

class AwsRuntimeProvider implements RuntimeProvider {
  readonly cloud = true;
  accepts(target: CloudTarget): boolean { return target.provider === 'AWS'; }
  assertIdentity(connection: AutomationConnection, inspected: CloudTargetInspection): void {
    if (connection.trust.method !== 'AWS_IAM_ROLE' || inspected.identity !== connection.trust.roleArn)
      throw coded('automation_cloud_identity_mismatch');
  }
  apply(input: ApplyInput, connection: AutomationConnection) {
    if (input.target.provider !== 'AWS' || !input.target.service || connection.trust.method !== 'AWS_IAM_ROLE')
      throw coded('automation_cloud_target_invalid');
    return applyEcsAutomation({ ...input, target: { ...input.target, service: input.target.service },
      expectedRoleArn: connection.trust.roleArn });
  }
}

const providers: Record<AutomationConnection['provider'], RuntimeProvider | undefined> = {
  PORTABLE: new PortableRuntimeProvider(),
  GOOGLE_CLOUD: new GoogleCloudRuntimeProvider(),
  AWS: new AwsRuntimeProvider(),
  GITHUB: undefined,
};

export function runtimeProvider(connection: AutomationConnection): RuntimeProvider {
  const provider = Object.prototype.hasOwnProperty.call(providers, connection.provider)
    ? providers[connection.provider]
    : undefined;
  if (!provider) throw coded('automation_cloud_target_invalid');
  return provider;
}
