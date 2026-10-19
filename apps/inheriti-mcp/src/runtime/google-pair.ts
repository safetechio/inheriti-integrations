import { inspectCloudTargetForPairing, pairCloudRunAutomation } from '@safetech/inheriti-elements-core/node-base';
import type { MetadataTools } from '../server.js';
import { coded } from './errors.js';

export async function pairGoogleAutomationService(this: MetadataTools, input: {
  connectionId: string; project: string; region: string; service: string; expectedRevision: string;
}) {
  const selectionVersion = this.selectionVersion;
  const selected = await this.automationOperations();
  if (!('operations' in selected)) return selected;
  const connection = await selected.operations.getConnection(input.connectionId);
  if (connection.provider !== 'GOOGLE_CLOUD' ||
      connection.trust.method !== 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC' ||
      connection.status === 'DISABLED') throw coded('automation_cloud_identity_mismatch');

  const target = { provider: 'GOOGLE_CLOUD' as const, project: input.project,
    region: input.region, service: input.service };
  const inspected = await inspectCloudTargetForPairing(target);
  if (selectionVersion !== this.selectionVersion) throw coded('organization_selection_changed');
  if (inspected.identityNumericId !== connection.trust.serviceAccountSubject)
    throw coded('automation_cloud_identity_mismatch');
  if (inspected.revision !== input.expectedRevision) throw coded('automation_cloud_revision_changed');

  const result = await pairCloudRunAutomation({
    target, expectedRevision: inspected.revision,
    expectedSubject: connection.trust.serviceAccountSubject,
    environment: {
      INHERITI_AUTOMATION_PROVIDER: 'GOOGLE_CLOUD',
      INHERITI_AUTOMATION_CONNECTION_ID: connection.id,
      INHERITI_AUTOMATION_AUDIENCE: connection.trust.audience,
    },
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
