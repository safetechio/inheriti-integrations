import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerActivateAutomationGrant(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'activate_automation_grant',
    {
      description:
        'Activate an existing plan grant after the human confirms the intended connection and responsible member.',
      inputSchema: z.object({ planId: z.string().min(1), grantId: z.string().min(1) }),
    },
    safeResult(({ planId, grantId }: { planId: string; grantId: string }) =>
      tools.manageAutomationGrant('activate', planId, { grantId }),
    ),
  );
}
