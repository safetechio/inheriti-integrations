import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerListOrganizations(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'list_organizations',
    {
      description:
        'List available organizations and the current selection. May return a browser sign-in URL.',
      inputSchema: z.object({}),
    },
    safeResult(() => tools.listOrganizations()),
  );
}
