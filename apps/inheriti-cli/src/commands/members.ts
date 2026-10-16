import React from 'react';
import { Box, Text } from 'ink';
import type { NodeIntegrationCore } from '@safetech/inheriti-elements-core/node-base';
import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';
import { renderJson } from '../output.js';
import { renderTo } from '../render/ink.js';
import { Table } from '../render/table.jsx';
import { timestamp } from '../render/values.js';

export type MemberLogsOptions = NonNullable<Parameters<NodeIntegrationCore['listMemberLogs']>[1]> & { format: 'table' | 'json' };

export async function listMemberLogs(context: CliContext, terminal: Terminal, memberId: string, options: MemberLogsOptions): Promise<number> {
  if (!(await context.core.getAccessToken())) throw new Error('operator_not_signed_in');
  const { format, ...input } = options;
  const page = await context.core.listMemberLogs(memberId, input);
  if (format === 'json') { renderJson(terminal, page); return 0; }
  if (context.organization) terminal.write(`Organisation: ${context.organization.name} (${context.organization.id})`);
  if (page.items.length === 0) { terminal.write('No member activity found.'); return 0; }
  renderTo(terminal, React.createElement(Box, { flexDirection: 'column' },
    React.createElement(Table<(typeof page.items)[number]>, { width: terminal.columns, rows: page.items, columns: [
      { header: 'when', value: item => timestamp(item.occurredOn) },
      { header: 'source', value: item => item.source },
      { header: 'event', value: item => item.event, flexible: true, minimum: 18 },
      { header: 'status', value: item => item.status ?? '—' },
    ] }),
    React.createElement(Text, { dimColor: true }, `${page.items.length} of ${page.total} logs · offset ${options.offset ?? 0}`),
  ));
  return 0;
}
