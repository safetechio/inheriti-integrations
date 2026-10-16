import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';
import { pendingJobInstruction } from './reveal-instruction.js';

export function registerDownloadPlanAsset(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'download_plan_asset',
    {
      description: 'Open the secure window to download a plan file. ' + pendingJobInstruction,
      inputSchema: z.object({ planId: z.string().min(1), asset: z.string().min(1) }),
    },
    safeResult(({ planId, asset }: { planId: string; asset: string }) =>
      tools.reveal(planId, asset, 'ASSET'),
    ),
  );
}
