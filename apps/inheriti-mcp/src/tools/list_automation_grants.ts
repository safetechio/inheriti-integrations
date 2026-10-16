import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerListAutomationGrants(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'list_automation_grants',
    {
      description:
        'List safe automation grant metadata for an editable plan in the selected organization, when Business permits.',
      inputSchema: z.object({ planId: z.string().min(1) }),
    },
    safeResult(({ planId }: { planId: string }) => tools.listAutomationGrants(planId)),
  );
}
