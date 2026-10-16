import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MetadataTools } from '../server.js';
import { safeResult } from '../server.js';
import { cloudTarget, fieldMapping } from './prepare_automation_runtime.js';
import type { CloudTarget } from '@safetech/inheriti-elements-core/node-base';

export function registerApplyAutomationRuntime(server: McpServer, tools: MetadataTools) {
  server.registerTool('apply_automation_runtime', {
    description: 'Explicitly deploy an already-built immutable image for a verified, granted plan to an existing Cloud Run job, Cloud Run service, or ECS service. ' +
      'Call prepare_automation_runtime first and show its revision and resolved mappings. Pass those exact explicit mappings here; ' +
      'bulk selectors are intentionally unavailable during apply. Ask the operator to confirm the target, image digest, plan field mappings, ' +
      'environment names and revision before calling. The image must include the Inheriti CLI at cliPath. ' +
      'This changes the cloud workload; it does not build or publish an image or reveal secret values.',
    inputSchema: z.object({
      planId: z.string().uuid(), connectionId: z.string().uuid(),
      field: z.string().min(3).optional(), environmentVariable: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
      mappings: z.array(fieldMapping).min(1).optional(),
      target: cloudTarget, image: z.string().min(1).describe('Already-built immutable image reference.'),
      cliPath: z.string().startsWith('/'), expectedRevision: z.string().min(1),
    }),
  }, safeResult(input => tools.applyAutomationRuntime({ planId: input.planId, connectionId: input.connectionId,
    ...(input.field ? { field: input.field } : {}),
    ...(input.environmentVariable ? { environmentVariable: input.environmentVariable } : {}),
    ...(input.mappings ? { mappings: input.mappings } : {}),
    target: input.target as CloudTarget, image: input.image, cliPath: input.cliPath,
    expectedRevision: input.expectedRevision })));
}
