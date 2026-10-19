import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { chooseInheritiFile, openInheritiFile } from '@safetech/inheriti-elements-core/node-base';
import { safeResult } from '../server.js';

export function registerOpenInheritiFile(server: McpServer) {
  server.registerTool(
    'open_inheriti_file',
    {
      description: 'Ask the operator to choose a local .inheriti file, then open it in Inheriti Workspace. The file path and contents never enter this conversation.',
      inputSchema: z.object({}),
    },
    safeResult(async () => {
      try {
        await openInheritiFile(await chooseInheritiFile());
        return { status: 'opened_in_viewer' };
      } catch (error) {
        return { status: (error as Error).message === 'viewer_file_selection_canceled' ? 'canceled' : 'viewer_unavailable_or_file_invalid' };
      }
    }),
  );
}
