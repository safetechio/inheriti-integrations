import { createGoogleSecretPublisher, resolveAutomationFieldMappings } from '@safetech/inheriti-elements-core/node-base';
import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';
import { renderJson } from '../output.js';
import { registerCliCancel } from '../cancellation.js';
import { consumePlanFieldBatches, loadRevealPlan, renderRequestedValue } from './reveal.js';

const usage = 'Usage: inheriti secrets publish google --plan PLAN_ID --project PROJECT_ID --secret-prefix PREFIX (--map KEY=ASSET.FIELD ... | --map-all [--except ASSET.FIELD ...] | --only ASSET.FIELD ...) [--apply]';

type Selection = { plan: string; project: string; prefix: string; apply: boolean; mapAll: boolean;
  mappings: { envName: string; selector: string }[]; only: string[]; except: string[] };

function parse(argv: readonly string[]): Selection | undefined {
  const values: Record<string, string> = {};
  const mappings: Selection['mappings'] = [];
  const only: string[] = [];
  const except: string[] = [];
  const flags = { index: 0, apply: false, mapAll: false };
  while (flags.index < argv.length) {
    const key = argv[flags.index++]!;
    if (key === '--apply' || key === '--map-all') {
      if (key === '--apply' && flags.apply || key === '--map-all' && flags.mapAll) return;
      if (key === '--apply') flags.apply = true;
      if (key === '--map-all') flags.mapAll = true;
      continue;
    }
    if (!['--plan', '--project', '--secret-prefix', '--map', '--only', '--except'].includes(key)) return;
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
  if (!values['--plan'] || !values['--project'] || !values['--secret-prefix'] ||
      (!flags.mapAll && !only.length && !mappings.length) || flags.mapAll && only.length ||
      except.length && !flags.mapAll) return;
  return { plan: values['--plan'], project: values['--project'], prefix: values['--secret-prefix'],
    apply: flags.apply, mapAll: flags.mapAll, mappings, only, except };
}

function publicationValue(value: unknown): string {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol')
    throw new Error('google_secret_value_invalid');
  try {
    if (JSON.stringify(value) === undefined) throw new Error('google_secret_value_invalid');
    return renderRequestedValue(value);
  } catch { throw new Error('google_secret_value_invalid'); }
}

export async function publishGoogleSecrets(context: CliContext, terminal: Terminal, argv: readonly string[]): Promise<number> {
  const options = parse(argv);
  if (!options) { terminal.writeError(usage); return 1; }
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
  if (!mappings) { terminal.writeError('Check plan text fields, duplicate names, and conflicting selections.'); return 1; }
  const publisher = createGoogleSecretPublisher({ projectId: options.project });
  const targets = mappings.map(item => ({ ...item, secretId: `${options.prefix}${item.envName}` }));
  const controller = new AbortController();
  const unregister = registerCliCancel(controller);
  try {
    const inspection = await Promise.all(targets.map(item => publisher.inspectSecret(item.secretId)));
    if (controller.signal.aborted) throw new Error('google_secret_publication_outcome_unknown');
    renderJson(terminal, { status: options.apply ? 'applying' : 'preview', projectId: options.project,
      destination: 'GOOGLE_CLOUD_SECRET_MANAGER', mappings: targets.map(item => ({
        selector: item.selector, key: item.envName, target: `projects/${options.project}/secrets/${item.secretId}` })), inspection });
    if (!options.apply) return 0;
    await consumePlanFieldBatches(context, terminal, options.plan, plan,
      targets.map(item => ({
        fields: [{ selector: item.selector, action: 'USE_FIELD' as const, destination: 'GOOGLE_CLOUD_SECRET_MANAGER' as const }],
        destination: async (fields: ReadonlyArray<{ selector: string; value: unknown }>) => {
          const result = await publisher.publishSecret(item.secretId, publicationValue(fields[0]?.value), controller.signal);
          renderJson(terminal, result);
        },
      })), controller.signal, { completion: 'Secrets published to Google Cloud Secret Manager.' });
    return 0;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('google_secret_publication_outcome_unknown', { cause: error });
    throw error;
  } finally { unregister(); }
}
