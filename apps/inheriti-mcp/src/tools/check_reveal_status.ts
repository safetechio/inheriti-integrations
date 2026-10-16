import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';
import { pendingJobInstruction } from './reveal-instruction.js';

export function registerCheckRevealStatus(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'check_reveal_status',
    {
      description: 'Check or cancel a pending local delivery. ' + pendingJobInstruction,
      inputSchema: z.object({ jobId: z.string().uuid(), cancel: z.boolean().optional() }),
    },
    safeResult(({ jobId, cancel }: { jobId: string; cancel?: boolean | undefined }) =>
      tools.revealStatus(jobId, cancel),
    ),
  );
}
