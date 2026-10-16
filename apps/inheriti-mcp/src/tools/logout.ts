import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerLogout(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'logout',
    {
      description: 'Cancel local work, forget held keys, and clear this MCP session.',
      inputSchema: z.object({}),
    },
    safeResult(() => tools.logout()),
  );
}
