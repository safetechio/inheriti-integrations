import {
  generateAutomationRuntimeBundle,
  inspectCloudTarget,
  previewCloudTarget,
  resolveAutomationFieldMappings,
} from '@safetech/inheriti-elements-core/node-base';
import type { CloudTarget } from '@safetech/inheriti-elements-core/node-base';
import type { MetadataTools } from '../server.js';
import { coded } from './errors.js';
import { runtimeProvider } from './runtime-provider.js';

export type RuntimeFieldInput = { field?: string; environmentVariable?: string;
  mappings?: ReadonlyArray<{ selector: string; envName: string }> };

const mappingsFor = (input: RuntimeFieldInput) => input.mappings ??
  (input.field && input.environmentVariable ? [{ selector: input.field, envName: input.environmentVariable }] : []);

export async function prepareAutomationRuntime(
  this: MetadataTools,
  input: {
    planId: string;
    connectionId: string;
    field?: string;
    environmentVariable?: string;
    mappings?: ReadonlyArray<{ selector: string; envName: string }>;
    mapAll?: boolean;
    onlyFields?: readonly string[];
    exceptFields?: readonly string[];
    target?: CloudTarget;
    launcherPath?: string;
  },
) {
  const selectionVersion = this.selectionVersion;
  const selected = await this.automationOperations();
  if (!('operations' in selected)) return selected;
  const [planResult, grants, connection] = await Promise.all([
    this.getPlan(input.planId),
    selected.operations.listGrants(input.planId),
    selected.operations.getConnection(input.connectionId),
  ]);
  if (!('organizationId' in planResult)) return planResult;
  if (selectionVersion !== this.selectionVersion || planResult.organizationId !== selected.organizationId)
    throw coded('organization_selection_changed');
  if (!grants.some((grant) => grant.connectionId === input.connectionId && grant.status === 'ACTIVE'))
    throw coded('automation_active_grant_required');
  if (connection.status !== 'VERIFIED') throw coded('automation_verified_connection_required');
  if (input.mappings && (input.field || input.environmentVariable))
    throw coded('automation_plan_field_invalid');
  if ((input.mapAll && input.onlyFields?.length) || (input.exceptFields?.length && !input.mapAll) ||
      ((input.mapAll || input.onlyFields?.length) && (input.field || input.environmentVariable)))
    throw coded('automation_plan_field_invalid');
  const mappings = (() => {
    try {
      return resolveAutomationFieldMappings(planResult.plan.assets.map(asset => ({
        id: asset.id,
        ...(asset.code ? { code: asset.code } : {}),
        isBinary: asset.isBinary,
        fieldNames: asset.fieldNames,
      })), {
        ...(input.mapAll ? { mapAll: true } : {}),
        ...(input.onlyFields ? { onlyFields: input.onlyFields } : {}),
        ...(input.exceptFields ? { exceptFields: input.exceptFields } : {}),
        mappings: mappingsFor(input),
      });
    } catch {
      return undefined;
    }
  })();
  if (!mappings?.length) throw coded('automation_plan_field_invalid');

  const bundle = generateAutomationRuntimeBundle({
    planId: input.planId,
    connection,
    mappings,
  });
  const provider = runtimeProvider(connection);
  if (!provider.cloud) {
    if (input.target || input.launcherPath) throw coded('automation_cloud_target_invalid');
    return { organizationId: selected.organizationId, planId: input.planId, connectionId: input.connectionId,
      ...bundle, mappings, applied: false };
  }
  if (!input.target && !input.launcherPath) {
    return { organizationId: selected.organizationId, planId: input.planId, connectionId: input.connectionId,
      ...bundle, mappings, applied: false };
  }
  if (!input.target || !provider.accepts(input.target) || !input.launcherPath)
    throw coded('automation_cloud_target_invalid');
  const inspected = await inspectCloudTarget(input.target);
  if (selectionVersion !== this.selectionVersion) throw coded('organization_selection_changed');
  provider.assertIdentity(connection, inspected);
  const preview = previewCloudTarget(inspected, input.launcherPath, Object.keys(bundle.environment));
  return { organizationId: selected.organizationId, planId: input.planId, connectionId: input.connectionId,
    ...bundle, mappings, preview, applied: false };
}

export async function applyAutomationRuntime(
  this: MetadataTools,
  input: {
    planId: string;
    connectionId: string;
    field?: string;
    environmentVariable?: string;
    mappings?: ReadonlyArray<{ selector: string; envName: string }>;
    target: CloudTarget;
    image: string;
    cliPath: string;
    expectedRevision: string;
  },
) {
  if (input.mappings && (input.field || input.environmentVariable))
    throw coded('automation_plan_field_invalid');
  if (!input.cliPath.startsWith('/') || !input.expectedRevision || !input.image)
    throw coded('automation_cloud_target_invalid');
  const selectionVersion = this.selectionVersion;
  const prepared = await prepareAutomationRuntime.call(this, {
    planId: input.planId, connectionId: input.connectionId, mappings: mappingsFor(input),
    target: input.target, launcherPath: input.cliPath,
  });
  if (!('preview' in prepared) || !prepared.preview || prepared.preview.revision !== input.expectedRevision)
    throw coded('automation_cloud_revision_changed');
  if (selectionVersion !== this.selectionVersion) throw coded('organization_selection_changed');
  const selected = await this.automationOperations();
  if (!('operations' in selected)) return selected;
  if (selected.organizationId !== prepared.organizationId || selectionVersion !== this.selectionVersion)
    throw coded('organization_selection_changed');
  const [connection, grants] = await Promise.all([
    selected.operations.getConnection(input.connectionId), selected.operations.listGrants(input.planId),
  ]);
  if (selectionVersion !== this.selectionVersion || connection.status !== 'VERIFIED' ||
      !grants.some(grant => grant.connectionId === input.connectionId && grant.status === 'ACTIVE'))
    throw coded('organization_selection_changed');
  const common = {
    target: input.target, expectedRevision: input.expectedRevision, planId: input.planId,
    mappings: mappingsFor(input), image: input.image,
    cliPath: input.cliPath, environment: prepared.environment,
  };
  const result = await runtimeProvider(connection).apply(common, connection, prepared.preview);
  return { organizationId: prepared.organizationId, planId: input.planId, connectionId: input.connectionId,
    ...result, imagePreparation: 'The immutable image must already include the Inheriti CLI at cliPath.' };
}
