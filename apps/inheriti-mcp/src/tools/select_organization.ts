import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerSelectOrganization(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'select_organization',
    {
      description: 'Select an organization by ID from list_organizations.',
      inputSchema: z.object({ id: z.string().min(1) }),
    },
    safeResult(({ id }: { id: string }) => tools.selectOrganization(id)),
  );
}
