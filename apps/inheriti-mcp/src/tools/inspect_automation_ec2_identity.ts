import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { inspectEc2AutomationInstance } from '@safetech/inheriti-elements-core/node-base';
import type { MetadataTools } from '../server.js';
import { safeResult } from '../server.js';
import { coded } from '../runtime/errors.js';

export function registerInspectAutomationEc2Identity(server: McpServer, tools: MetadataTools) {
  server.registerTool('inspect_automation_ec2_identity', {
    description: 'Read the IAM role attached to one existing EC2 instance using the locally authenticated AWS CLI. ' +
      'Use the returned roleArn when creating an AWS automation connection. Do not request AWS credentials in chat.',
    inputSchema: z.object({ region: z.string().min(1), instanceId: z.string().min(1) }),
  }, safeResult(async input => {
    const selectionVersion = tools.selectionVersion;
    const selected = await tools.automationOperations();
    if (!('operations' in selected)) return selected;
    const instance = await inspectEc2AutomationInstance(input);
    if (selectionVersion !== tools.selectionVersion) throw coded('organization_selection_changed');
    return { organizationId: selected.organizationId, ...instance };
  }));
}
