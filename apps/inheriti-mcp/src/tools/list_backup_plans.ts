import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';
import { CANONICAL_PLAN_ASSET_TYPES } from '@safetech/inheriti-elements-core/node-base';

const inputSchema = z.object({
  cursor: z.string().max(1024).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  status: z.array(z.string().min(1).max(40)).min(1).max(10).optional(),
  assetType: z.enum(CANONICAL_PLAN_ASSET_TYPES).optional(),
  namePrefix: z.string().min(1).max(200).optional(),
}).strict();

export function registerListBackupPlans(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'list_backup_plans',
    {
      description:
        'List plan metadata in the selected organization. Filter by Business statuses such as PROTECTED, DRAFT or MIGRATED. May return a browser sign-in URL.',
      inputSchema,
    },
    safeResult(({ cursor, limit, status, assetType, namePrefix }: z.infer<typeof inputSchema>) => tools.listPlans({
      ...(cursor === undefined ? {} : { cursor }),
      ...(limit === undefined ? {} : { limit }),
      ...(status === undefined ? {} : { status }),
      ...(assetType === undefined ? {} : { assetType }),
      ...(namePrefix === undefined ? {} : { namePrefix }),
    })),
  );
}
