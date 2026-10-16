import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerCheckAutomationSetupStatus(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'check_automation_setup_status',
    {
      description:
        'Check or cancel local automation setup. Report the status to the human; this server cannot ' +
        'wake the assistant.',
      inputSchema: z.object({ jobId: z.string().uuid(), cancel: z.boolean().optional() }),
    },
    safeResult(({ jobId, cancel }: { jobId: string; cancel?: boolean | undefined }) =>
      tools.automationSetupStatus(jobId, cancel),
    ),
  );
}
