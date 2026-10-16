import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerStartAutomationPairing(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'start_automation_pairing',
    {
      description:
        'Open a short-lived, server-side identity pairing window for an existing connection. ' +
        'The configured workload runs inheriti automations pair redeem with its native provider identity. ' +
        'No pairing secret or proof enters tool output or chat. Check list_automation_connections for VERIFIED status. ' +
        'Use start_automation_setup only as a manual fallback.',
      inputSchema: z.object({ connectionId: z.string().uuid() }),
    },
    safeResult(({ connectionId }: { connectionId: string }) =>
      tools.startAutomationPairing(connectionId),
    ),
  );
}
