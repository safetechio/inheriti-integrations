import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MetadataTools } from '../server.js';
import { safeResult } from '../server.js';
import { fieldMapping } from './prepare_automation_runtime.js';

export function registerPrepareAutomationEc2(server: McpServer, tools: MetadataTools) {
  server.registerTool('prepare_automation_ec2', {
    description: 'Inspect an EC2 instance profile role and prepare a persistent systemd startup wrapper for approved plan fields. ' +
      'Show the resolved field mappings, application command and generated unit to the operator. This tool never changes the remote instance. ' +
      'The operator installs the launcher and unit once; each service start uses the existing Inheriti reveal and approval flow.',
    inputSchema: z.object({
      planId: z.string().uuid(), connectionId: z.string().uuid(), region: z.string().min(1),
      instanceId: z.string().min(1), serviceName: z.string().min(1), runAsUser: z.string().min(1),
      launcherPath: z.string().startsWith('/').default('/usr/local/bin/inheriti-automation'),
      applicationCommand: z.array(z.string().min(1)).min(1),
      mappings: z.array(fieldMapping).min(1).optional(), mapAll: z.boolean().optional(),
      onlyFields: z.array(z.string().min(3)).min(1).optional(),
      exceptFields: z.array(z.string().min(3)).min(1).optional(),
    }),
  }, safeResult(input => tools.prepareAutomationEc2({
    planId: input.planId, connectionId: input.connectionId, region: input.region,
    instanceId: input.instanceId, serviceName: input.serviceName, runAsUser: input.runAsUser,
    launcherPath: input.launcherPath, applicationCommand: input.applicationCommand,
    ...(input.mappings ? { mappings: input.mappings } : {}),
    ...(input.mapAll ? { mapAll: true } : {}),
    ...(input.onlyFields ? { onlyFields: input.onlyFields } : {}),
    ...(input.exceptFields ? { exceptFields: input.exceptFields } : {}),
  })));
}
