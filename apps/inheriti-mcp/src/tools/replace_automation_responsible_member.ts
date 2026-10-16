import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerReplaceAutomationResponsibleMember(
  server: McpServer,
  tools: MetadataTools,
) {
  server.registerTool(
    'replace_automation_responsible_member',
    {
      description: 'Replace the responsible member for an existing plan grant.',
      inputSchema: z.object({
        planId: z.string().min(1),
        grantId: z.string().min(1),
        responsibleMemberId: z.string().min(1),
      }),
    },
    safeResult(
      ({
        planId,
        grantId,
        responsibleMemberId,
      }: {
        planId: string;
        grantId: string;
        responsibleMemberId: string;
      }) => tools.manageAutomationGrant('replace', planId, { grantId, responsibleMemberId }),
    ),
  );
}
