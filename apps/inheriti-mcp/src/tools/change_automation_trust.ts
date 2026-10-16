import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';
import { trustSchema } from './automation-trust-schema.js';
import type { AutomationTrustInput } from '../server.js';

export function registerChangeAutomationTrust(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'change_automation_trust',
    {
      description:
        'Replace nonsecret trust metadata for an automation connection. Ask for the exact provider ' +
        'values described in the trust fields. Never include a private key or identity proof. The ' +
        'human must reverify identity in start_automation_setup.',
      inputSchema: z.object({ connectionId: z.string().min(1), trust: trustSchema }),
    },
    safeResult(({ connectionId, trust }: { connectionId: string; trust: AutomationTrustInput }) =>
      tools.changeAutomationTrust(connectionId, trust),
    ),
  );
}
