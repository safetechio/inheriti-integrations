import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';
import { isGithubAutomationSelector } from '@safetech/inheriti-elements-core/node-base';

export function registerGithubAutomationUsage(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'github_automation_usage',
    {
      description:
        'Generate copyable GitHub Actions YAML for an active plan grant and verified GitHub ' +
        'connection using the Business verified Action and CLI release. Use get_backup_plan to offer ' +
        'real asset.code + fieldNames choices and ask the human to select one. Never request a secret ' +
        'value. The generated command only checks that injection worked.',
      inputSchema: z.object({
        planId: z.string().min(1),
        connectionId: z.string().min(1),
        field: z
          .string()
          .refine(
            isGithubAutomationSelector,
            'Use a valid asset.field selector from the plan Data tab.',
          )
          .describe('Nonsecret asset.field selector from the plan Data tab.'),
      }),
    },
    safeResult(
      ({ planId, connectionId, field }: { planId: string; connectionId: string; field: string }) =>
        tools.githubAutomationUsage(planId, connectionId, field),
    ),
  );
}
