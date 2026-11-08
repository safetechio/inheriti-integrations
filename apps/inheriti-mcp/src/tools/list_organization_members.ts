import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

const inputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().nonnegative().safe().optional(),
}).strict();

export function registerListOrganizationMembers(server: McpServer, tools: MetadataTools) {
  server.registerTool('list_organization_members', {
    description: 'List member names, roles and status for the selected organisation. Requires permission to manage members.',
    inputSchema,
  }, safeResult(({ limit, offset }: z.infer<typeof inputSchema>) => tools.listOrganizationMembers({
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
  })));
}
