import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerAbortPlanAccess(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'abort_plan_access',
    {
      description: 'Cancel an interrupted plan access in the selected organization.',
      inputSchema: z.object({
        planId: z.string().min(1),
        expectedRevealId: z.string().min(1).optional(),
      }),
    },
    safeResult(
      ({ planId, expectedRevealId }: { planId: string; expectedRevealId?: string | undefined }) =>
        tools.abortPlanAccess(planId, expectedRevealId),
    ),
  );
}
