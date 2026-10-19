import {
  inspectCloudTargetForPairing,
  inspectEc2AutomationInstance,
  pairEcsAutomation,
  prepareEc2AutomationService,
} from '@safetech/inheriti-elements-core/node-base';
import type { MetadataTools } from '../server.js';
import { coded } from './errors.js';
import { prepareAutomationRuntime } from './runtime-setup.js';

export async function pairAwsAutomationService(this: MetadataTools, input: {
  connectionId: string; region: string; cluster: string; service: string; container?: string;
  image: string; cliPath: string; expectedRevision: string;
}) {
  const selectionVersion = this.selectionVersion;
  const selected = await this.automationOperations();
  if (!('operations' in selected)) return selected;
  const connection = await selected.operations.getConnection(input.connectionId);
  if (connection.provider !== 'AWS' || connection.trust.method !== 'AWS_IAM_ROLE' || connection.status === 'DISABLED')
    throw coded('automation_cloud_identity_mismatch');
  const target = { provider: 'AWS' as const, region: input.region, cluster: input.cluster,
    service: input.service, ...(input.container ? { container: input.container } : {}) };
  const inspected = await inspectCloudTargetForPairing(target);
  if (selectionVersion !== this.selectionVersion) throw coded('organization_selection_changed');
  if (inspected.identity !== connection.trust.roleArn) throw coded('automation_cloud_identity_mismatch');
  if (inspected.revision !== input.expectedRevision) throw coded('automation_cloud_revision_changed');
  const result = await pairEcsAutomation({
    target, expectedRevision: inspected.revision, expectedRoleArn: connection.trust.roleArn,
    image: input.image, cliPath: input.cliPath,
    environment: { INHERITI_AUTOMATION_PROVIDER: 'AWS',
      INHERITI_AUTOMATION_CONNECTION_ID: connection.id, AWS_REGION: target.region },
    startPairing: async () => {
      if (selectionVersion !== this.selectionVersion) throw coded('organization_selection_changed');
      await selected.operations.startPairing(connection.id);
    },
  });
  if (selectionVersion !== this.selectionVersion) throw coded('organization_selection_changed');
  const verified = await selected.operations.getConnection(connection.id);
  if (verified.status !== 'VERIFIED') throw coded('automation_verified_connection_required');
  return { organizationId: selected.organizationId, connectionId: connection.id, ...result };
}

export async function prepareAutomationEc2(this: MetadataTools, input: {
  planId: string; connectionId: string; region: string; instanceId: string;
  serviceName: string; runAsUser: string; launcherPath: string; applicationCommand: string[];
  mappings?: ReadonlyArray<{ selector: string; envName: string }>;
  mapAll?: boolean; onlyFields?: readonly string[]; exceptFields?: readonly string[];
}) {
  const selectionVersion = this.selectionVersion;
  const prepared = await prepareAutomationRuntime.call(this, {
    planId: input.planId, connectionId: input.connectionId,
    ...(input.mappings ? { mappings: input.mappings } : {}),
    ...(input.mapAll ? { mapAll: true } : {}),
    ...(input.onlyFields ? { onlyFields: input.onlyFields } : {}),
    ...(input.exceptFields ? { exceptFields: input.exceptFields } : {}),
  });
  if (!('provider' in prepared) || prepared.provider !== 'AWS') throw coded('automation_cloud_target_invalid');
  const selected = await this.automationOperations();
  if (!('operations' in selected)) return selected;
  const connection = await selected.operations.getConnection(input.connectionId);
  const instance = await inspectEc2AutomationInstance({ region: input.region, instanceId: input.instanceId });
  if (selectionVersion !== this.selectionVersion || selected.organizationId !== prepared.organizationId)
    throw coded('organization_selection_changed');
  if (connection.trust.method !== 'AWS_IAM_ROLE' || instance.roleArn !== connection.trust.roleArn)
    throw coded('automation_cloud_identity_mismatch');
  const service = prepareEc2AutomationService({
    bundle: { ...prepared, environment: { ...prepared.environment, AWS_REGION: instance.region } },
    applicationCommand: input.applicationCommand, serviceName: input.serviceName,
    runAsUser: input.runAsUser, launcherPath: input.launcherPath,
  });
  return { organizationId: selected.organizationId, planId: input.planId, connectionId: input.connectionId,
    instanceId: instance.instanceId, roleArn: instance.roleArn,
    mappings: prepared.mappings, launcher: prepared.script, ...service, applied: false };
}
