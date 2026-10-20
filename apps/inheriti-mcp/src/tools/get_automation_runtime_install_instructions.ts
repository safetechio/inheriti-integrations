import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerGetAutomationRuntimeInstallInstructions(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'get_automation_runtime_install_instructions',
    {
      description: 'Get the exact verified Inheriti CLI runtime package and Dockerfile installation snippet for AWS ECS or Google Cloud Run. Use this before preparing the workload image; do not ask the user to run a separate local CLI command or choose a deployment channel.',
      inputSchema: z.strictObject({}),
    },
    safeResult(() => tools.getAutomationRuntimeInstallInstructions()),
  );
}
