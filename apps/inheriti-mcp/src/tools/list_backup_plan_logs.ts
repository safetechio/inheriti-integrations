import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerListBackupPlanLogs(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'list_backup_plan_logs',
    {
      description: 'List safe plan activity fields and total count in the selected organization.',
      inputSchema: z.object({
        planId: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().nonnegative().safe().optional(),
      }),
    },
    safeResult(
      ({
        planId,
        limit,
        offset,
      }: {
        planId: string;
        limit?: number | undefined;
        offset?: number | undefined;
      }) => tools.listPlanLogs(planId, limit, offset),
    ),
  );
}
