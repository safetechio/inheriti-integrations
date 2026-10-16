import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerListAutomationMembers(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'list_automation_members',
    {
      description:
        'List member IDs, display names, and status in the selected organization for choosing a ' +
        'responsible member on an automation grant, when Business permits. No email or credentials ' +
        'are returned.',
      inputSchema: z.object({}),
    },
    safeResult(() => tools.listAutomationMembers()),
  );
}
