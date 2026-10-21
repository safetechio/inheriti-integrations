import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';

export function registerGetAutomationRuntimeInstallInstructions(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'get_automation_runtime_install_instructions',
    {
      description: 'Get the exact verified Inheriti CLI runtime package, Linux EC2 host command, and Dockerfile installation snippet for AWS ECS or Google Cloud Run. Use the Linux host command before pairing plain EC2; use the Dockerfile snippet before building a container. Do not ask the user to choose a deployment channel.',
      inputSchema: z.strictObject({}),
    },
    safeResult(() => tools.getAutomationRuntimeInstallInstructions()),
  );
}
