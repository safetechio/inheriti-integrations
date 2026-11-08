import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

const inputSchema = z.object({ planId: z.string().uuid() }).strict();

export function registerGetPlanResponsibilities(server: McpServer, tools: MetadataTools) {
  server.registerTool('get_plan_responsibilities', {
    description: 'List declared participants and their roles on an accessible plan. This does not calculate effective access.',
    inputSchema,
  }, safeResult(({ planId }: z.infer<typeof inputSchema>) => tools.getPlanResponsibilities(planId)));
}
