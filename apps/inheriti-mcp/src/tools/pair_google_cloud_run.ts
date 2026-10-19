import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MetadataTools } from '../server.js';
import { safeResult } from '../server.js';

export function registerPairGoogleCloudRun(server: McpServer, tools: MetadataTools) {
  server.registerTool('pair_google_cloud_run', {
    description: 'Verify a Google Cloud Run service connection with one temporary job using the service image and identity. ' +
      'Call inspect_automation_cloud_identity for the service and review its generation, project, region and service account first. ' +
      'The image must contain Inheriti CLI. This tool opens the pairing window, runs and removes the temporary job; ' +
      'it does not update the service or expose the proof.',
    inputSchema: z.object({
      connectionId: z.string().uuid(), project: z.string().min(1), region: z.string().min(1),
      service: z.string().min(1), expectedRevision: z.string().min(1),
    }),
  }, safeResult(input => tools.pairGoogleAutomationService(input)));
}
