import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { inspectCloudIdentity } from '@safetech/inheriti-elements-core/node-base';
import type { CloudTarget } from '@safetech/inheriti-elements-core/node-base';
import type { MetadataTools } from '../server.js';
import { safeResult } from '../server.js';
import { coded } from '../runtime/errors.js';
import { cloudTarget } from './prepare_automation_runtime.js';

export function registerInspectAutomationCloudIdentity(server: McpServer, tools: MetadataTools) {
  server.registerTool('inspect_automation_cloud_identity', {
    description: 'Read the identity of an existing Cloud Run job or ECS service/task definition ' +
      'using the locally authenticated provider CLI. Return only the service account numeric ID ' +
      'or task role ARN. Use this before creating a Business connection so the operator does not ' +
      'run gcloud or aws manually. Do not request provider credentials in chat.',
    inputSchema: cloudTarget,
  }, safeResult(async (input) => {
    const selectionVersion = tools.selectionVersion;
    const selected = await tools.automationOperations();
    if (!('operations' in selected)) return selected;
    const identity = await inspectCloudIdentity(input as CloudTarget);
    if (selectionVersion !== tools.selectionVersion) throw coded('organization_selection_changed');
    return { organizationId: selected.organizationId, provider: input.provider, ...identity };
  }));
}
