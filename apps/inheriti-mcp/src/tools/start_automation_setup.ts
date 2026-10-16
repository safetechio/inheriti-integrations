import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerStartAutomationSetup(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'start_automation_setup',
    {
      description:
        'Manual fallback: open the local secure window for a human to enter identity proof for an existing automation ' +
        'connection. The running workload must supply the proof through an existing secure transfer path; ' +
        'this tool does not collect it from Cloud Run or ECS. The proof stays in the window; never pass ' +
        'it as a tool argument or in conversation. Then check_automation_setup_status.',
      inputSchema: z.object({ connectionId: z.string().min(1) }),
    },
    safeResult(({ connectionId }: { connectionId: string }) =>
      tools.startAutomationSetup(connectionId),
    ),
  );
}
