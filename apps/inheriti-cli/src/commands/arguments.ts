import { quickPlanAssetCatalog, localPlanAssetLimit } from '@safetech/inheriti-elements-core/node-base';
import type { LocalPlanHints } from '@safetech/inheriti-elements-core/node-base';
import { isFieldSelector } from './reveal.js';
import type { MemberLogsOptions } from './members.js';
import type { ListPlansOptions, PlanLogsOptions } from './plans.js';

const GOVERNED_FLAG_REMOVED = 'Reveals no longer take --governed: the plan applies its own approval rules automatically.';

export function extractOrganization(argv: readonly string[]): { argv: string[]; organizationId?: string } | { error: string } {
  const separator = argv.indexOf('--');
  const before = separator < 0 ? argv : argv.slice(0, separator);
  const after = separator < 0 ? [] : argv.slice(separator);
  const index = before.indexOf('--organization');
  if (index < 0) return { argv: [...argv] };
  const organizationId = before[index + 1];
  if (!organizationId || organizationId.startsWith('--')) return { error: '--organization requires an ID.' };
  return { argv: [...before.slice(0, index), ...before.slice(index + 2), ...after], organizationId };
}

/**
 * Output is a table unless a caller asks for JSON: a person reads the listing far more often than a
 * script parses it, and the JSON carries the pagination cursor a table deliberately leaves out.
 */
export function parseFormat(argv: readonly string[]): { format: 'table' | 'json' } | { error: string } {
  const state = { format: 'table' as 'table' | 'json' };
  for (const option of argv) {
    if (option === '--json') {
      state.format = 'json';
      continue;
    }
    if (option === '--table') {
      state.format = 'table';
      continue;
    }
    return { error: `Unknown option: ${option}` };
  }
  return { format: state.format };
}

export function parseListOptions(argv: readonly string[]): ListPlansOptions | { error: string } {
  const state = { format: 'table' as 'table' | 'json', limit: undefined as number | undefined, cursor: undefined as string | undefined, all: false };
  for (const position = { index: 0 }; position.index < argv.length; position.index += 1) {
    const option = argv[position.index];
    if (option === '--json') {
      state.format = 'json';
      continue;
    }
    if (option === '--table') {
      state.format = 'table';
      continue;
    }
    if (option === '--all') {
      state.all = true;
      continue;
    }
    if (option === '--limit' && argv[position.index + 1]) {
      const value = Number(argv[++position.index]);
      if (!Number.isInteger(value) || value < 1) return { error: 'plans list --limit takes a positive whole number.' };
      state.limit = value;
      continue;
    }
    if (option === '--cursor' && argv[position.index + 1]) {
      state.cursor = argv[++position.index];
      continue;
    }
    return { error: `Unknown or incomplete option: ${option}` };
  }
  return {
    format: state.format,
    all: state.all,
    ...(state.limit === undefined ? {} : { limit: state.limit }),
    ...(state.cursor === undefined ? {} : { cursor: state.cursor }),
  };
}

export function parseLogOptions(argv: readonly string[]): PlanLogsOptions | { error: string } {
  const state = { format: 'table' as 'table' | 'json', limit: undefined as number | undefined, offset: undefined as number | undefined };
  for (const position = { index: 0 }; position.index < argv.length; position.index += 1) {
    const option = argv[position.index];
    if (option === '--json') {
      state.format = 'json';
      continue;
    }
    if (option === '--table') {
      state.format = 'table';
      continue;
    }
    if (option === '--limit' || option === '--offset') {
      const raw = argv[++position.index];
      const value = Number(raw);
      if (!raw || !Number.isSafeInteger(value)
        || value < (option === '--limit' ? 1 : 0)
        || (option === '--limit' && value > 100)) {
        return { error: `${option} takes ${option === '--limit' ? 'a whole number from 1 to 100' : 'a non-negative whole number'}.` };
      }
      if (option === '--limit') state.limit = value;
      if (option === '--offset') state.offset = value;
      continue;
    }
    return { error: `Unknown or incomplete logs option: ${option}` };
  }
  return {
    format: state.format,
    ...(state.limit === undefined ? {} : { limit: state.limit }),
    ...(state.offset === undefined ? {} : { offset: state.offset }),
  };
}

export function parseMemberLogOptions(argv: readonly string[]): MemberLogsOptions | { error: string } {
  const common: string[] = [];
  const result: MemberLogsOptions = { format: 'table' };
  for (const position = { index: 0 }; position.index < argv.length; position.index++) {
    const option = argv[position.index];
    if (option !== '--source' && option !== '--from' && option !== '--to') {
      common.push(option!);
      if (option === '--limit' || option === '--offset') common.push(argv[++position.index]!);
      continue;
    }
    const value = argv[++position.index];
    if (!value || value.startsWith('--')) return { error: `${option} requires a value.` };
    if (option === '--source') {
      if (value !== 'MEMBER' && value !== 'AUTOMATION') return { error: '--source must be MEMBER or AUTOMATION.' };
      result.source = value;
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))
      || new Date(value).toISOString().slice(0, 10) !== value) {
      return { error: `${option} requires a valid date.` };
    }
    if (option === '--from') result.from = value;
    if (option === '--to') result.to = value;
  }
  const base = parseLogOptions(common);
  return 'error' in base ? base : { ...result, ...base };
}

/**
 * A reveal takes no mode. Whether a plan is governed is a property of the plan, which the command
 * reads before it starts, so asking the operator to declare it only ever produced the wrong one.
 */
export function parseRevealOptions(argv: readonly string[]): { fields?: string[]; clipboardTtlMs?: number } | { error: string } {
  const state = { clipboardTtlMs: undefined as number | undefined };
  const fields: string[] = [];
  for (const position = { index: 0 }; position.index < argv.length; position.index += 1) {
    const option = argv[position.index];
    if (option === '--clipboard-ttl') {
      if (state.clipboardTtlMs !== undefined) return { error: '--clipboard-ttl may be given only once.' };
      state.clipboardTtlMs = durationMs(argv[++position.index] ?? '');
      if (state.clipboardTtlMs === undefined) return { error: '--clipboard-ttl expects a positive duration no greater than 2147483647ms.' };
      continue;
    }
    if (option === '--governed') return { error: GOVERNED_FLAG_REMOVED };
    if (option !== '--field' || !argv[position.index + 1]) return { error: 'Unknown or incomplete reveal option.' };
    const field = argv[++position.index]!;
    if (!isFieldSelector(field)) return { error: '--field expects asset.field.' };
    if (fields.includes(field)) return { error: '--field selectors must be unique.' };
    fields.push(field);
  }
  const parsed: { fields?: string[]; clipboardTtlMs?: number } = {};
  if (fields.length > 0) parsed.fields = fields;
  if (state.clipboardTtlMs !== undefined) parsed.clipboardTtlMs = state.clipboardTtlMs;
  return parsed;
}

export function parseDownloadOptions(argv: readonly string[]): { asset: string; output: string } | { error: string } {
  const state = { asset: undefined as string | undefined, output: undefined as string | undefined };
  for (const position = { index: 0 }; position.index < argv.length; position.index += 1) {
    const option = argv[position.index];
    const value = argv[position.index + 1];
    if ((option !== '--asset' && option !== '--output') || !value || value.startsWith('--')) {
      return { error: `Unknown or incomplete download option: ${option}` };
    }
    if (option === '--asset') {
      if (state.asset) return { error: '--asset may be given only once.' };
      state.asset = value;
      position.index += 1;
      continue;
    }
    if (state.output) return { error: '--output may be given only once.' };
    state.output = value;
    position.index += 1;
  }
  return state.asset && state.output ? { asset: state.asset, output: state.output } : { error: 'plans download requires --asset and --output.' };
}

export function parseUseOptions(argv: readonly string[], commandName = 'plans use'): Omit<import('./use.js').UsePlanOptions, 'signal'> | { error: string } {
  const state = { stdin: undefined as string | undefined, ttlMs: undefined as number | undefined, output: 'suppress' as 'suppress' | 'inherit' };
  const separator = argv.indexOf('--');
  if (separator < 0) return { error: 'Pass the executable after --.' };
  const command = argv.slice(separator + 1);
  if (command.length === 0) return { error: 'Pass an executable after --.' };
  const envs: Array<{ name: string; selector: string }> = [];
  const tempFiles: Array<{ name: string; selector: string }> = [];
  const sockets: Array<{ name: string; selector: string }> = [];
  const fds: Array<{ fd: number; selector: string }> = [];
  for (const position = { index: 0 }; position.index < separator; position.index += 1) {
    const option = argv[position.index];
    const value = argv[++position.index];
    if (!value) return { error: `Incomplete ${commandName} option: ${option}` };
    if (option === '--stdin') {
      if (state.stdin !== undefined) return { error: '--stdin may be mapped only once.' };
      state.stdin = value;
      continue;
    }
    if (option === '--env') {
      const match = /^([^=]+)=(.+)$/u.exec(value);
      if (!match) return { error: '--env expects NAME=asset.field.' };
      envs.push({ name: match[1]!, selector: match[2]! });
      continue;
    }
    if (option === '--temp-file') {
      const match = /^([^=]+)=(.+)$/u.exec(value);
      if (!match) return { error: '--temp-file expects NAME=asset.field.' };
      tempFiles.push({ name: match[1]!, selector: match[2]! });
      continue;
    }
    if (option === '--socket') {
      const match = /^([^=]+)=(.+)$/u.exec(value);
      if (!match) return { error: '--socket expects NAME=asset.field.' };
      sockets.push({ name: match[1]!, selector: match[2]! });
      continue;
    }
    if (option === '--fd') {
      const match = /^(\d+)=(.+)$/u.exec(value);
      if (!match) return { error: '--fd expects N=asset.field.' };
      fds.push({ fd: Number(match[1]), selector: match[2]! });
      continue;
    }
    if (option === '--ttl') {
      if (state.ttlMs !== undefined) return { error: '--ttl may be given only once.' };
      state.ttlMs = durationMs(value);
      if (state.ttlMs === undefined) return { error: '--ttl expects a positive duration no greater than 2147483647ms.' };
      continue;
    }
    if (option === '--output') {
      if (value !== 'suppress' && value !== 'inherit') return { error: '--output expects suppress or inherit.' };
      state.output = value;
      continue;
    }
    return { error: `Unknown ${commandName} option: ${option}` };
  }
  return {
    ...(state.stdin === undefined ? {} : { stdin: state.stdin }), envs, tempFiles, sockets, fds, command,
    ...(state.ttlMs === undefined ? {} : { ttlMs: state.ttlMs }), output: state.output,
  };
}

export function parseResolveOptions(argv: readonly string[]): { field: string; allowPlaintextOutput: boolean } | { error: string } {
  const state = { field: undefined as string | undefined, allowed: false };
  for (const position = { index: 0 }; position.index < argv.length; position.index += 1) {
    const option = argv[position.index];
    if (option === '--allow-plaintext-output') {
      if (state.allowed) return { error: '--allow-plaintext-output may be given only once.' };
      state.allowed = true;
      continue;
    }
    if (option !== '--field' || !argv[position.index + 1]) return { error: 'Unknown or incomplete secrets resolve option.' };
    if (state.field !== undefined) return { error: '--field may be mapped only once.' };
    state.field = argv[++position.index];
    if (!isFieldSelector(state.field!)) return { error: '--field expects asset.field.' };
  }
  if (state.field === undefined) return { error: 'secrets resolve requires --field asset.field.' };
  if (!state.allowed) return { error: 'Plaintext output requires --allow-plaintext-output.' };
  return { field: state.field, allowPlaintextOutput: state.allowed };
}

function durationMs(value: string): number | undefined {
  const match = /^(\d+)(ms|s|m|h)$/u.exec(value);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const factor = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[match[2]!]!;
  const result = amount * factor;
  return Number.isSafeInteger(result) && result > 0 && result <= 2_147_483_647 ? result : undefined;
}


export function parsePlanHints(args: readonly string[]): LocalPlanHints | undefined {
  const hints: { title?: string; description?: string; assetTypes: string[] } = { assetTypes: [] };
  for (const position = { index: 0 }; position.index < args.length; position.index += 2) {
    const key = args[position.index];
    const value = args[position.index + 1];
    if (!value || value.startsWith('--')) return;
    if (key === '--title' && !hints.title && value.trim().length <= 200) {
      hints.title = value.trim();
      continue;
    }
    if (key === '--description' && !hints.description && value.trim().length <= 1_000) {
      hints.description = value.trim();
      continue;
    }
    if (key === '--asset' && quickPlanAssetCatalog.some(({ id }) => id === value)
      && !hints.assetTypes.includes(value) && hints.assetTypes.length < localPlanAssetLimit) {
      hints.assetTypes.push(value);
      continue;
    }
    return;
  }
  return hints;
}
