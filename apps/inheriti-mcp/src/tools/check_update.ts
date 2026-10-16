import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerCheckUpdate(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'check_update',
    {
      description:
        'Check this MCP server version and whether an update exists in its locked channel. Does not ' +
        'expose a download URL.',
      inputSchema: z.object({}),
    },
    safeResult(() => tools.checkUpdate()),
  );
}
