import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

const inputSchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
}).strict().refine(input => (input.from === undefined && input.to === undefined) ||
  (input.from !== undefined && input.to !== undefined && Date.parse(input.from) <= Date.parse(input.to)),
{ message: 'invalid_date_range' });

export function registerGetOrganizationInsights(server: McpServer, tools: MetadataTools) {
  server.registerTool('get_organization_insights', {
    description: 'Get authorised organisation plan, member and access trends. Date filters apply to charts and results; named monthly and 30-day statistics retain their fixed windows. Requires permission to manage members.',
    inputSchema,
  }, safeResult(({ from, to }: z.infer<typeof inputSchema>) => tools.getOrganizationInsights({
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
  })));
}
