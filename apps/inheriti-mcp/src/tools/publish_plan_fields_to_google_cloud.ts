import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';
import { pendingJobInstruction } from './reveal-instruction.js';

export function registerPublishPlanFieldsToGoogleCloud(server: McpServer, tools: MetadataTools) {
  server.registerTool('publish_plan_fields_to_google_cloud', {
    description: 'Optional one-time copy for existing Google Cloud Secret Manager consumers; direct Inheriti runtime uses secrets exec. After publication, reads use Google Cloud IAM. Plan changes or revocation do not update or delete the copies; there is no automatic synchronization or rotation. Preview or publish selected protected plan fields as separate Google Cloud Secret Manager secrets. ' +
      'Use apply: false first. Get explicit approval for the project, target secret names and mappings before apply: true. ' +
      'Apply uses the protected reveal lifecycle. Secret values never enter tool results. ' + pendingJobInstruction,
    inputSchema: z.object({
      planId: z.string().min(1), projectId: z.string().min(1), secretPrefix: z.string(),
      mappings: z.array(z.object({ selector: z.string().min(3), key: z.string().min(1) })).min(1),
      apply: z.boolean().default(false),
    }),
  }, safeResult((input: { planId: string; projectId: string; secretPrefix: string;
    mappings: Array<{ selector: string; key: string }>; apply: boolean }) =>
    tools.publishPlanFieldsToGoogleCloud(input)));
}
