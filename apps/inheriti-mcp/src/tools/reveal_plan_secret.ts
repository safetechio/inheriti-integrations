import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';
import { pendingJobInstruction } from './reveal-instruction.js';

export function registerRevealPlanSecret(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'reveal_plan_secret',
    {
      description:
        'Open the secure window to reveal selected plan fields and files. Use selector, selectors and assets, or all: true. ' +
        pendingJobInstruction,
      inputSchema: z.object({
        planId: z.string().min(1),
        selector: z.string().min(3).optional(),
        selectors: z.array(z.string().min(3)).min(1).optional(),
        assets: z.array(z.string().min(1)).min(1).optional(),
        all: z.literal(true).optional(),
      }),
    },
    safeResult(
      ({
        planId,
        selector,
        selectors,
        assets,
        all,
      }: {
        planId: string;
        selector?: string | undefined;
        selectors?: string[] | undefined;
        assets?: string[] | undefined;
        all?: boolean | undefined;
      }) => tools.revealFields(planId, { selector, selectors, assets, all }),
    ),
  );
}
