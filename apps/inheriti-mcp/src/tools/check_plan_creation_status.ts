import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerCheckPlanCreationStatus(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'check_plan_creation_status',
    {
      description: 'Check or cancel local assisted plan creation.',
      inputSchema: z.object({ jobId: z.string().uuid(), cancel: z.boolean().optional() }),
    },
    safeResult(({ jobId, cancel }: { jobId: string; cancel?: boolean | undefined }) =>
      tools.planCreationStatus(jobId, cancel),
    ),
  );
}
