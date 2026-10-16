import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerListAutomationConnections(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'list_automation_connections',
    {
      description:
        'List safe automation connection metadata in the selected organization, when Business ' +
        'permits. Identity proof is never returned.',
      inputSchema: z.object({}),
    },
    safeResult(() => tools.listAutomationConnections()),
  );
}
