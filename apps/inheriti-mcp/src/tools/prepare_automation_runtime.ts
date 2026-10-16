import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MetadataTools } from '../server.js';
import { safeResult } from '../server.js';
import type { CloudTarget } from '@safetech/inheriti-elements-core/node-base';

export const cloudTarget = z.union([
  z.object({ provider: z.literal('GOOGLE_CLOUD'), project: z.string().min(1), region: z.string().min(1),
    job: z.string().min(1), service: z.never().optional(), container: z.string().optional() }),
  z.object({ provider: z.literal('GOOGLE_CLOUD'), project: z.string().min(1), region: z.string().min(1),
    service: z.string().min(1), job: z.never().optional(), container: z.string().optional() }),
  z.object({ provider: z.literal('AWS'), region: z.string().min(1), cluster: z.string().min(1),
    service: z.string().optional(), taskDefinition: z.string().optional(), container: z.string().optional() }),
]);

export const fieldMapping = z.object({ selector: z.string().min(3),
  envName: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/) });

export function registerPrepareAutomationRuntime(server: McpServer, tools: MetadataTools) {
  server.registerTool('prepare_automation_runtime', {
    description: 'Prepare a copyable runtime launcher for a verified connection and active plan grant. ' +
      'First use get_backup_plan to show real text fields, list_automation_connections and list_automation_grants; ' +
      'ask whether to map all plan text fields, include only selected fields, or exclude a few. Show the resolved ' +
      'selector-to-environment mappings for review; explicit mappings can rename generated environment names. ' +
      'For managed Cloud Run or ECS, ' +
      'ask for the target; the local gcloud or aws CLI inspects it and returns a safe preview. This tool never changes ' +
      'cloud resources or reveals secrets. The operator adds the launcher and Inheriti CLI to an immutable image, ' +
      'then may explicitly use apply_automation_runtime. Without a target it returns a launcher for a VM or cluster ' +
      'that the operator must install separately.',
    inputSchema: z.object({
      planId: z.string().uuid(),
      connectionId: z.string().uuid(),
      field: z.string().min(3).optional().describe('Legacy single asset.code.fieldName selector.'),
      environmentVariable: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
      mappings: z.array(fieldMapping).min(1).optional().describe('Nonsecret environment name to plan field mappings.'),
      mapAll: z.boolean().optional().describe('Select every text field in the plan.'),
      onlyFields: z.array(z.string().min(3)).min(1).optional().describe('Select only these ASSET.FIELD selectors.'),
      exceptFields: z.array(z.string().min(3)).min(1).optional().describe('Exclude these ASSET.FIELD selectors from mapAll.'),
      target: cloudTarget.optional(),
      launcherPath: z.string().optional().describe('Absolute path where the launcher will be installed inside the cloud image.'),
    }),
  }, safeResult((input) => tools.prepareAutomationRuntime({
    planId: input.planId,
    connectionId: input.connectionId,
    ...(input.field ? { field: input.field } : {}),
    ...(input.environmentVariable ? { environmentVariable: input.environmentVariable } : {}),
    ...(input.mappings ? { mappings: input.mappings } : {}),
    ...(input.mapAll ? { mapAll: true } : {}),
    ...(input.onlyFields ? { onlyFields: input.onlyFields } : {}),
    ...(input.exceptFields ? { exceptFields: input.exceptFields } : {}),
    ...(input.target ? { target: input.target as CloudTarget } : {}),
    ...(input.launcherPath ? { launcherPath: input.launcherPath } : {}),
  })));
}
