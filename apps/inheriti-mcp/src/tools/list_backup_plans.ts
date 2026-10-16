import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerListBackupPlans(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'list_backup_plans',
    {
      description:
        'List plan metadata in the selected organization. May return a browser sign-in URL.',
      inputSchema: z.object({ cursor: z.string().optional() }),
    },
    safeResult(({ cursor }: { cursor?: string | undefined }) => tools.listPlans(cursor)),
  );
}
