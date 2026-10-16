import { createAwsSecretPublisher, resolveAutomationFieldMappings } from '@safetech/inheriti-elements-core/node-base';
import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';
import { renderJson } from '../output.js';
import { registerCliCancel } from '../cancellation.js';
import { consumePlanFieldBatches, consumePlanFields, loadRevealPlan, renderRequestedValue } from './reveal.js';

const usage = 'Usage: inheriti secrets publish aws --plan PLAN_ID --region AWS_REGION --account-id 12_DIGITS (--secret NAME | --parameter-prefix /PATH) (--map KEY=ASSET.FIELD ... | --map-all [--except ASSET.FIELD ...] | --only ASSET.FIELD ...) [--apply]';
type Selection = { plan: string; region: string; accountId: string; secret?: string; prefix?: string; apply: boolean;
  mapAll: boolean; mappings: { envName: string; selector: string }[]; only: string[]; except: string[] };

function publicationValue(value: unknown): string {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol')
    throw new Error('automation_aws_publication_value_invalid');
  try {
    if (JSON.stringify(value) === undefined) throw new Error('automation_aws_publication_value_invalid');
    return renderRequestedValue(value);
  } catch { throw new Error('automation_aws_publication_value_invalid'); }
}

function parse(argv: readonly string[]): Selection | undefined {
  const values: Record<string, string> = {};
  const mappings: Selection['mappings'] = [];
  const only: string[] = [];
  const except: string[] = [];
  const flags = { apply: false, mapAll: false, index: 0 };
  while (flags.index < argv.length) {
    const key = argv[flags.index++]!;
    if (key === '--apply' || key === '--map-all') {
      if (key === '--apply' && flags.apply || key === '--map-all' && flags.mapAll) return;
      if (key === '--apply') flags.apply = true;
      if (key === '--map-all') flags.mapAll = true;
      continue;
    }
    if (!['--plan', '--region', '--account-id', '--secret', '--parameter-prefix', '--map', '--only', '--except'].includes(key)) return;
    const value = argv[flags.index++];
    if (!value || value.startsWith('--')) return;
    if (key === '--map') {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.+\..+)$/.exec(value);
      if (!match) return;
      mappings.push({ envName: match[1]!, selector: match[2]! });
      continue;
    }
    if (key === '--only') { only.push(value); continue; }
    if (key === '--except') { except.push(value); continue; }
    if (values[key]) return;
    values[key] = value;
  }
  if (!values['--plan'] || !values['--region'] || !/^\d{12}$/.test(values['--account-id'] ?? '') ||
      Boolean(values['--secret']) === Boolean(values['--parameter-prefix']) ||
      (!flags.mapAll && !only.length && !mappings.length) || (flags.mapAll && only.length) ||
      (except.length && !flags.mapAll)) return;
  return { plan: values['--plan'], region: values['--region'], accountId: values['--account-id']!,
    ...(values['--secret'] ? { secret: values['--secret'] } : {}),
    ...(values['--parameter-prefix'] ? { prefix: values['--parameter-prefix'] } : {}),
    apply: flags.apply, mapAll: flags.mapAll, mappings, only, except };
}

export async function publishAwsSecrets(context: CliContext, terminal: Terminal, argv: readonly string[]): Promise<number> {
  const options = parse(argv);
  if (!options) { terminal.writeError(usage); return 1; }
  if (!options.secret && (!options.prefix?.startsWith('/') || options.prefix === '/')) {
    terminal.writeError(usage); return 1;
  }
  const plan = await loadRevealPlan(context, options.plan);
  const mappings = (() => {
    try {
      return resolveAutomationFieldMappings(plan.assets, {
        ...(options.mapAll ? { mapAll: true } : {}),
        ...(options.only.length ? { onlyFields: options.only } : {}),
        ...(options.except.length ? { exceptFields: options.except } : {}), mappings: options.mappings,
      });
    } catch { return undefined; }
  })();
  if (!mappings) {
    terminal.writeError('Check plan text fields, duplicate names, and conflicting selections.');
    return 1;
  }
  const publisher = createAwsSecretPublisher({ region: options.region, expectedAccountId: options.accountId });
  const targets = mappings.map(item => ({ ...item,
    target: options.secret ?? `${options.prefix!.replace(/\/$/, '')}/${item.envName}` }));
  const controller = new AbortController();
  const unregister = registerCliCancel(controller);
  try {
    const inspected = options.secret
      ? [await publisher.inspectSecret(options.secret)]
      : await Promise.all(targets.map(item => publisher.inspectParameter(item.target)));
    if (controller.signal.aborted) throw new Error('automation_aws_publication_outcome_unknown');
    renderJson(terminal, { status: options.apply ? 'applying' : 'preview', region: options.region,
      accountId: options.accountId, destination: options.secret ? 'AWS_SECRETS_MANAGER' : 'AWS_PARAMETER_STORE',
      mappings: targets.map(({ selector, envName, target }) => ({ selector, key: envName, target })), targets: inspected });
    if (!options.apply) return 0;
    if (options.secret) {
      await consumePlanFields(context, terminal, options.plan, plan,
        targets.map(({ selector }) => ({ selector, action: 'USE_FIELD', destination: 'AWS_SECRETS_MANAGER' })),
        controller.signal, async fields => {
          const values = new Map(fields.map(field => [field.selector, publicationValue(field.value)]));
          const result = await publisher.publishSecret(options.secret!, targets.map(item => ({ key: item.envName, value: values.get(item.selector)! })), controller.signal);
          renderJson(terminal, result);
        }, { completion: 'Secret published to AWS Secrets Manager.' });
      return 0;
    }
    await consumePlanFieldBatches(context, terminal, options.plan, plan,
      targets.map(item => ({
        fields: [{ selector: item.selector, action: 'USE_FIELD' as const, destination: 'AWS_PARAMETER_STORE' as const }],
        destination: async (fields: ReadonlyArray<{ selector: string; value: unknown }>) => {
          const result = await publisher.publishParameter(item.target, publicationValue(fields[0]?.value), controller.signal);
          renderJson(terminal, result);
        },
      })), controller.signal, { completion: 'Parameters published to AWS Parameter Store.' });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('automation_aws_publication_outcome_unknown', { cause: error });
    throw error;
  } finally { unregister(); }
  return 0;
}
