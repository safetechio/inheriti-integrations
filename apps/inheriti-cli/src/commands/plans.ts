import React from 'react';
import type { PlanSummary } from '@safetech/inheriti-elements-core';
import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';
import { renderJson } from '../output.js';
import { renderTo } from '../render/ink.js';
import { promptSelect } from '../render/select.jsx';
import { planCandidates } from '../completion/candidates.js';
import { PlanView, PlansList } from '../render/plans.jsx';
import { Table } from '../render/table.jsx';
import { timestamp } from '../render/values.js';
import { Box, Text } from 'ink';

export class OperatorNotSignedIn extends Error {
  constructor() { super('operator_not_signed_in'); this.name = 'OperatorNotSignedIn'; }
}

export interface ListPlansOptions {
  format: 'table' | 'json';
  limit?: number;
  cursor?: string;
  all?: boolean;
}

/** Enough pages to exhaust a TEST Application without ever looping on a cursor the API keeps returning. */
const MAXIMUM_PAGES = 50;

export async function listPlans(
  context: CliContext,
  terminal: Terminal,
  options: ListPlansOptions = { format: 'table' },
): Promise<number> {
  await requireSession(context);
  const { items, nextCursor } = await collect(context, options);
  if (options.format === 'json') {
    renderJson(terminal, { ...(context.organization ? { organization: context.organization } : {}), items, nextCursor });
    return 0;
  }
  if (items.length === 0) {
    terminal.write(context.organization ? `No plans in ${context.organization.name}.` : 'No plans in this Application.');
    return 0;
  }
  if (context.organization) terminal.write(`Organization: ${context.organization.name} (${context.organization.id})`);
  renderTo(terminal, React.createElement(PlansList, { plans: items, more: nextCursor !== null, width: terminal.columns }));
  return 0;
}

export interface ShowPlanOptions {
  format: 'table' | 'json';
}

export interface PlanLogsOptions extends ShowPlanOptions {
  limit?: number;
  offset?: number;
}

export async function listPlanLogs(context: CliContext, terminal: Terminal, planId: string, options: PlanLogsOptions = { format: 'table' }): Promise<number> {
  await requireSession(context);
  const result = await context.core.listPlanLogs(planId, {
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.offset === undefined ? {} : { offset: options.offset }),
  });
  if (options.format === 'json') {
    renderJson(terminal, result);
    return 0;
  }
  if (context.organization) terminal.write(`Organization: ${context.organization.name} (${context.organization.id})`);
  if (result.items.length === 0) { terminal.write('No logs for this plan.'); return 0; }
  renderTo(terminal, React.createElement(Box, { flexDirection: 'column' },
    React.createElement(Table<(typeof result.items)[number]>, { width: terminal.columns, rows: result.items, columns: [
      { header: 'when', value: (item: typeof result.items[number]) => timestamp(item.occurredOn) },
      { header: 'event', value: (item: typeof result.items[number]) => item.event },
      { header: 'status', value: (item: typeof result.items[number]) => item.status ?? '—' },
      { header: 'title', value: (item: typeof result.items[number]) => item.title, flexible: true, minimum: 16 },
      { header: 'details', value: (item: typeof result.items[number]) => item.details.map(detail => `${detail.label}: ${detail.value}`).join('; ') || '—', flexible: true, minimum: 20 },
    ] }),
    React.createElement(Text, { dimColor: true }, `${result.items.length} of ${result.total} logs · offset ${options.offset ?? 0}`),
  ));
  return 0;
}

export class PlanIdRequired extends Error {
  constructor() { super('plan_id_required'); this.name = 'PlanIdRequired'; }
}

/**
 * A plan id is a UUID nobody types from memory, so an interactive terminal gets a picker instead of
 * a usage error. A pipe still gets the error: a script that forgot the id must fail, not block.
 */
export async function resolvePlanId(
  context: CliContext,
  terminal: Terminal,
  planId: string | undefined,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw Object.assign(new Error('reveal_canceled'), { name: 'AbortError' });
  if (planId) return planId;
  await requireSession(context);
  if (!terminal.interactive) throw new PlanIdRequired();
  const candidates = await planCandidates(context);
  if (signal?.aborted) throw Object.assign(new Error('reveal_canceled'), { name: 'AbortError' });
  const chosen = await promptSelect('Which plan?', candidates, signal);
  if (signal?.aborted) throw Object.assign(new Error('reveal_canceled'), { name: 'AbortError' });
  if (!chosen) throw new PlanIdRequired();
  return chosen;
}

/**
 * Gives up the access this operator holds on a plan.
 *
 * A governed access outlives the reveal that opened it: a reveal that was cancelled, errored or was
 * killed leaves one running, and the next `plans reveal` takes it up where it stopped. This is the
 * other choice — the access is not wanted, and the next reveal should start clean. Nothing open is
 * not a failure; it is the state the operator asked for.
 */
export async function abortPlanAccess(
  context: CliContext,
  terminal: Terminal,
  planId: string,
): Promise<number> {
  await requireSession(context);
  const { aborted } = await context.core.abortPlanAccess(planId);
  terminal.write(aborted
    ? 'Access aborted. The next reveal of this plan will start a new request.'
    : 'No access is open on this plan.');
  return 0;
}

export async function showPlan(
  context: CliContext,
  terminal: Terminal,
  planId: string,
  options: ShowPlanOptions = { format: 'table' },
): Promise<number> {
  await requireSession(context);
  const plan = await context.core.getPlan(planId);
  if (options.format === 'json') {
    renderJson(terminal, context.organization ? { organization: context.organization, plan } : plan);
    return 0;
  }
  if (context.organization) terminal.write(`Organization: ${context.organization.name} (${context.organization.id})`);
  renderTo(terminal, React.createElement(PlanView, { plan, width: terminal.columns, keyOwner: context.keyOwner }));
  return 0;
}

/** `--all` is the only reason a host should ever hold a cursor: it never leaves this function. */
async function collect(
  context: CliContext,
  options: ListPlansOptions,
): Promise<{ items: PlanSummary[]; nextCursor: string | null }> {
  const items: PlanSummary[] = [];
  let cursor = options.cursor;
  for (let page = 0; page < MAXIMUM_PAGES; page += 1) {
    const result = await context.core.listPlans({
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(cursor === undefined ? {} : { cursor }),
    });
    items.push(...result.items);
    cursor = result.nextCursor ?? undefined;
    if (options.all !== true || cursor === undefined) return { items, nextCursor: result.nextCursor ?? null };
  }
  return { items, nextCursor: cursor ?? null };
}

/** A missing session is an ordinary state with its own message, not a 401 the operator has to decode. */
async function requireSession(context: CliContext): Promise<void> {
  if (!(await context.core.getAccessToken())) throw new OperatorNotSignedIn();
}
