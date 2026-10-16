import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';
import { pendingJobInstruction } from './reveal-instruction.js';

export function registerPublishPlanFieldsToAws(server: McpServer, tools: MetadataTools) {
  server.registerTool('publish_plan_fields_to_aws', {
    description: 'Optional one-time copy for existing AWS secret-store consumers; direct Inheriti runtime uses secrets exec. After publication, reads use AWS IAM. Plan changes or revocation do not update or delete the copy; there is no automatic synchronization or rotation. Preview or publish selected protected plan fields to one AWS Secrets Manager JSON secret or separate SSM SecureString parameters. ' +
      'Call with apply: false to inspect targets. Before calling with apply: true, get the user’s explicit approval for the exact AWS account, region, destination and field mappings. ' +
      'Apply uses the protected reveal lifecycle. A secure native window shows the account, region, destination and mappings when custodian or device input is needed. Secret values never enter tool results. ' + pendingJobInstruction,
    inputSchema: z.object({
      planId: z.string().min(1), region: z.string().min(1), expectedAccountId: z.string().regex(/^\d{12}$/),
      mappings: z.array(z.object({ selector: z.string().min(3), key: z.string().min(1) })).min(1),
      secretName: z.string().min(1).optional(), parameterPrefix: z.string().min(1).optional(),
      apply: z.boolean().default(false),
    }),
  }, safeResult((input: { planId: string; region: string; expectedAccountId: string;
    mappings: Array<{ selector: string; key: string }>; secretName?: string | undefined; parameterPrefix?: string | undefined; apply: boolean }) =>
    tools.publishPlanFieldsToAws(input)));
}
