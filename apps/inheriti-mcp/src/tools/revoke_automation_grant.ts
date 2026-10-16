import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerRevokeAutomationGrant(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'revoke_automation_grant',
    {
      description: 'Revoke an existing plan grant.',
      inputSchema: z.object({ planId: z.string().min(1), grantId: z.string().min(1) }),
    },
    safeResult(({ planId, grantId }: { planId: string; grantId: string }) =>
      tools.manageAutomationGrant('revoke', planId, { grantId }),
    ),
  );
}
