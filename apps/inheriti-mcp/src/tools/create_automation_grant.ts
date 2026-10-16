import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerCreateAutomationGrant(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'create_automation_grant',
    {
      description:
        'Create plan access using the selected plan ID, created or listed connection ID, and an ' +
        'eligible member ID from list_automation_members. Ask the human which member is responsible; ' +
        'Business enforces plan editor permission. Activate separately after review.',
      inputSchema: z.object({
        planId: z.string().min(1),
        connectionId: z.string().min(1),
        responsibleMemberId: z.string().min(1),
      }),
    },
    safeResult(
      ({
        planId,
        connectionId,
        responsibleMemberId,
      }: {
        planId: string;
        connectionId: string;
        responsibleMemberId: string;
      }) => tools.manageAutomationGrant('create', planId, { connectionId, responsibleMemberId }),
    ),
  );
}
