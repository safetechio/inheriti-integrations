import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerGetBackupPlan(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'get_backup_plan',
    {
      description:
        'Get safe metadata for one plan in the selected organization, including asset codes and field ' +
        'names for automation selectors. Never request field values.',
      inputSchema: z.object({ id: z.string().min(1) }),
    },
    safeResult(({ id }: { id: string }) => tools.getPlan(id)),
  );
}
