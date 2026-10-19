import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';
import { pendingJobInstruction } from './reveal-instruction.js';

export function registerDownloadPlanAsset(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'download_plan_asset',
    {
      description: 'Download a plan file. The Business deployment decides whether it is saved as .inheriti; openLimit defaults to 1 when protected. ' + pendingJobInstruction,
      inputSchema: z.object({ planId: z.string().min(1), asset: z.string().min(1),
        openLimit: z.number().int().min(1).max(4294967295).optional() }).strict(),
    },
    safeResult(({ planId, asset, openLimit }: { planId: string; asset: string; openLimit?: number | undefined }) =>
      openLimit === undefined ? tools.reveal(planId, asset, 'ASSET') : tools.reveal(planId, asset, 'ASSET', { openLimit }),
    ),
  );
}
