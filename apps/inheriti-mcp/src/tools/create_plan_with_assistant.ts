import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeResult } from '../server.js';
import type { MetadataTools } from '../server.js';
import {
  quickPlanAssetCatalog,
  localPlanAssetLimit,
} from '@safetech/inheriti-elements-core/node-base';

export function registerCreatePlanWithAssistant(server: McpServer, tools: MetadataTools) {
  server.registerTool(
    'create_plan_with_assistant',
    {
      description:
        'Open the secure window to create a plan with suggestions from the local model. Optional ' +
        'title, description, and assetTypes prefill the single editable plan text; derive them from ' +
        'non-secret user context only. The user can edit that text and enter exact secret values in ' +
        'the window. Review before saving, then check_plan_creation_status.',
      inputSchema: z.object({
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().trim().max(1000).optional(),
        assetTypes: z
          .array(
            z
              .string()
              .refine(
                (type) => quickPlanAssetCatalog.some(({ id }) => id === type),
                'Unknown asset type',
              ),
          )
          .max(localPlanAssetLimit)
          .describe(`Possible types: ${quickPlanAssetCatalog.map(({ id }) => id).join(', ')}`)
          .optional(),
      }),
    },
    safeResult(
      ({
        title,
        description,
        assetTypes,
      }: {
        title?: string | undefined;
        description?: string | undefined;
        assetTypes?: string[] | undefined;
      }) =>
        tools.createPlanWithAssistant({
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(assetTypes ? { assetTypes } : {}),
        }),
    ),
  );
}
