import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

const inputSchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  limit: z.number().int().min(1).max(500).optional(),
  cursor: z.string().regex(/^[1-9]\d*$/u).optional(),
  category: z.string().min(1).max(100).optional(),
  memberId: z.string().uuid().optional(),
  responsibleMemberId: z.string().uuid().optional(),
}).strict().refine(input => Date.parse(input.from) <= Date.parse(input.to), { message: 'invalid_date_range' });

export function registerListOrganizationAuditTrail(server: McpServer, tools: MetadataTools) {
  server.registerTool('list_organization_audit_trail', {
    description: 'Review authorised organisation audit activity in a date range. Requires audit trail permission; returns safe event details.',
    inputSchema,
  }, safeResult(({ from, to, limit, cursor, category, memberId, responsibleMemberId }: z.infer<typeof inputSchema>) =>
    tools.listOrganizationAuditTrail({ from, to,
      ...(limit === undefined ? {} : { limit }),
      ...(cursor === undefined ? {} : { cursor }),
      ...(category === undefined ? {} : { category }),
      ...(memberId === undefined ? {} : { memberId }),
      ...(responsibleMemberId === undefined ? {} : { responsibleMemberId }),
    })));
}
