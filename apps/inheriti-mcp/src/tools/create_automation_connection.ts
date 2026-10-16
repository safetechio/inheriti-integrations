import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';
import { trustSchema } from './automation-trust-schema.js';
import type { AutomationTrustInput } from '../server.js';
import { AUTOMATION_PROVIDERS } from '@safetech/inheriti-elements-core/node-base';
import type { AutomationProvider } from '@safetech/inheriti-elements-core/node-base';

export function registerCreateAutomationConnection(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'create_automation_connection',
    {
      description:
        'Set up Business automation: first select an organization and protected plan, then ask which ' +
        'provider runs the job. Use existing authorized metadata where available; ask the human only ' +
        'for missing nonsecret provider values described in trust fields. For an existing Cloud Run ' +
        'job or ECS service, use inspect_automation_cloud_identity to obtain its numeric service ' +
        'account ID or task role ARN before creating the connection. Do not guess identities or ' +
        'ask for private keys, secret values, or identity proof. After creation, call ' +
        'start_automation_pairing to open the server-side verification window. Use start_automation_setup only for manual fallback; list eligible members, create a ' +
        'plan grant, and activate only after the human reviews the responsible member and connection. ' +
        'GitHub YAML comes from github_automation_usage only after verification, an active grant, and ' +
        'a verified release.',
      inputSchema: z.object({
        name: z.string().trim().min(1),
        provider: z.enum(AUTOMATION_PROVIDERS),
        environment: z.enum(['TEST', 'LIVE']),
        trust: trustSchema,
        managingTeamId: z.string().min(1).optional(),
      }),
    },
    safeResult(
      (input: {
        name: string;
        provider: AutomationProvider;
        environment: 'TEST' | 'LIVE';
        trust: AutomationTrustInput;
        managingTeamId?: string | undefined;
      }) => tools.createAutomationConnection(input),
    ),
  );
}
