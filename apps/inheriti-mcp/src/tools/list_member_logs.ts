import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerListMemberLogs(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'list_member_logs',
    {
      description:
        'List authorized member activity in the selected organization. Includes automation events ' +
        'when permitted. Returns only safe event fields; never raw event data.',
      inputSchema: z.object({
        memberId: z.string().min(1),
        source: z.enum(['MEMBER', 'AUTOMATION']).optional(),
        from: z.string().date().optional(),
        to: z.string().date().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().nonnegative().safe().optional(),
      }),
    },
    safeResult(
      ({
        memberId,
        source,
        from,
        to,
        limit,
        offset,
      }: {
        memberId: string;
        source?: 'MEMBER' | 'AUTOMATION' | undefined;
        from?: string | undefined;
        to?: string | undefined;
        limit?: number | undefined;
        offset?: number | undefined;
      }) =>
        tools.listMemberLogs(memberId, {
          ...(source === undefined ? {} : { source }),
          ...(from === undefined ? {} : { from }),
          ...(to === undefined ? {} : { to }),
          ...(limit === undefined ? {} : { limit }),
          ...(offset === undefined ? {} : { offset }),
        }),
    ),
  );
}
