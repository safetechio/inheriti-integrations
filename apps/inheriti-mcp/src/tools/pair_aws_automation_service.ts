import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MetadataTools } from '../server.js';
import { safeResult } from '../server.js';

export function registerPairAwsAutomationService(server: McpServer, tools: MetadataTools) {
  server.registerTool('pair_aws_automation_service', {
    description: 'Verify an AWS ECS or Fargate connection using one temporary task with the existing service task role. ' +
      'Inspect the service and show the exact image digest, task definition revision, cluster, region and role first. ' +
      'The image must contain Inheriti CLI. This tool registers and deregisters a temporary task definition; it does not update the service or expose the proof.',
    inputSchema: z.object({
      connectionId: z.string().uuid(), region: z.string().min(1), cluster: z.string().min(1),
      service: z.string().min(1), container: z.string().min(1).optional(),
      image: z.string().min(1), cliPath: z.string().startsWith('/').default('/usr/local/bin/inheriti'),
      expectedRevision: z.string().min(1),
    }),
  }, safeResult(input => tools.pairAwsAutomationService({
    connectionId: input.connectionId, region: input.region, cluster: input.cluster,
    service: input.service, image: input.image, cliPath: input.cliPath,
    expectedRevision: input.expectedRevision,
    ...(input.container ? { container: input.container } : {}),
  })));
}
