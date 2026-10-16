import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerDisableAutomationConnection(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'disable_automation_connection',
    {
      description: 'Disable an automation connection in the selected organization.',
      inputSchema: z.object({ connectionId: z.string().min(1) }),
    },
    safeResult(({ connectionId }: { connectionId: string }) =>
      tools.disableAutomationConnection(connectionId),
    ),
  );
}
