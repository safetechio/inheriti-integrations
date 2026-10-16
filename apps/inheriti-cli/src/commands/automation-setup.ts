import {
  createAutomationSetupOperations,
  generateAutomationRuntimeBundle,
  inspectCloudTarget,
  previewCloudTarget,
  resolveAutomationFieldMappings,
} from '@safetech/inheriti-elements-core/node-base';
import type { CliConfiguration } from '../configuration.js';
import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';
import { renderJson } from '../output.js';
import { promptSelect } from '../render/select.js';
import { cliAutomationProvider } from './automation-provider.js';

const usage = [
  'Usage: inheriti automations setup --plan PLAN_ID [--connection CONNECTION_ID]',
  '  (--map-all [--except ASSET.FIELD ...] | --only ASSET.FIELD ... | --map NAME=ASSET.FIELD ... | --field ASSET.FIELD --env-name NAME)',
  '  [--map NAME=ASSET.FIELD ...]  Override generated names when using --map-all or --only.',
  '  [--project PROJECT --region REGION (--job JOB | --service SERVICE)',
  '  | --region REGION --cluster CLUSTER (--service SERVICE | --task-definition ARN)]',
  '  [--container NAME] [--script-path ABSOLUTE_PATH]',
  '  [--cli-path ABSOLUTE_PATH] [--apply --image IMAGE [--expect-revision REVISION]]',
  '  CLI path defaults to /usr/local/bin/inheriti.',
].join('\n');
const allowed = new Set([
  '--plan', '--connection', '--field', '--env-name', '--map', '--map-all', '--only', '--except', '--project', '--region',
  '--job', '--cluster', '--service', '--task-definition', '--container', '--script-path',
  '--apply', '--image', '--cli-path', '--expect-revision',
]);

function parse(argv: readonly string[]): { options: Record<string, string>; mappings: Array<{selector: string; envName: string}>;
  onlyFields: string[]; exceptFields: string[] } | undefined {
  const options: Record<string, string> = {};
  const mappings: Array<{selector: string; envName: string}> = [];
  const onlyFields: string[] = [];
  const exceptFields: string[] = [];
  for (const [index, key] of argv.entries()) {
    if (!key.startsWith('--')) continue;
    if (key === '--map') {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.+\..+)$/.exec(argv[index + 1] ?? '');
      if (!match || mappings.some(item => item.envName === match[1])) return;
      mappings.push({ envName: match[1]!, selector: match[2]! });
      continue;
    }
    if (key === '--only' || key === '--except') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) return;
      (key === '--only' ? onlyFields : exceptFields).push(value);
      continue;
    }
    if (!allowed.has(key) || options[key]) return;
    if ((key === '--apply' || key === '--map-all') && (argv[index + 1] === undefined || argv[index + 1]?.startsWith('--'))) {
      options[key] = 'true';
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) return;
    options[key] = value;
  }
  const consumed = Object.keys(options).length * 2 - ['--apply', '--map-all'].filter(key => options[key] === 'true').length;
  return consumed + (mappings.length + onlyFields.length + exceptFields.length) * 2 === argv.length
    ? { options, mappings, onlyFields, exceptFields } : undefined;
}

export async function automationSetup(
  context: CliContext,
  configuration: CliConfiguration,
  terminal: Terminal,
  argv: readonly string[],
): Promise<number> {
  const parsed = parse(argv);
  const options = parsed?.options;
  const bulk = options?.['--map-all'] === 'true' || Boolean(parsed?.onlyFields.length);
  if (!options?.['--plan'] ||
      (!bulk && !parsed?.mappings.length && !(options['--field'] && options['--env-name'])) ||
      (options['--field'] || options['--env-name']) && (bulk || Boolean(parsed?.mappings.length)) ||
      (parsed?.exceptFields.length && options['--map-all'] !== 'true') ||
      (parsed?.onlyFields.length && options['--map-all']) ||
      (options['--map-all'] && options['--map-all'] !== 'true')) {
    terminal.writeError(usage);
    return 1;
  }
  const applying = options['--apply'] === 'true';
  const cliPath = options['--cli-path'] ?? '/usr/local/bin/inheriti';
  if ((options['--apply'] && !applying) || (applying && (!options['--image'] ||
      (!options['--expect-revision'] && !terminal.interactive) ||
      (bulk && !terminal.interactive) || options['--script-path'])) ||
      !cliPath.startsWith('/') ||
      (!applying && ['--image', '--expect-revision'].some(key => options[key]))) {
    terminal.writeError(usage);
    return 1;
  }
  if (!(await context.core.getAccessToken())) {
    terminal.writeError('Sign in before preparing automation.');
    return 1;
  }
  const plan = await context.core.getPlan(options['--plan']);
  const legacyMappings = options['--field'] && options['--env-name']
    ? [{ selector: options['--field'], envName: options['--env-name'] }] : [];
  const mappings = (() => {
    try {
      return resolveAutomationFieldMappings(plan.assets, {
      ...(options['--map-all'] ? { mapAll: true } : {}),
      ...(parsed!.onlyFields.length ? { onlyFields: parsed!.onlyFields } : {}),
      ...(parsed!.exceptFields.length ? { exceptFields: parsed!.exceptFields } : {}),
      mappings: [...parsed!.mappings, ...legacyMappings],
      });
    } catch {
      return undefined;
    }
  })();
  if (!mappings?.length) {
    terminal.writeError('Check plan text fields and environment names. Unknown fields, duplicate names, or conflicting selections are invalid; use --map NAME=ASSET.FIELD to rename a generated name.');
    return 1;
  }
  const operations = createAutomationSetupOperations({
    apiUrl: configuration.apiUrl,
    organizationId: context.organization!.id,
    getBearerToken: () => context.core.getAccessToken(),
  });
  const grants = await operations.listGrants(options['--plan']);
  const eligibleIds = new Set(grants.filter(grant => grant.status === 'ACTIVE').map(grant => grant.connectionId));
  const connectionId = options['--connection'] ?? (terminal.interactive
    ? await promptSelect('Which verified connection?', (await operations.listConnections())
      .filter(item => item.status === 'VERIFIED' && item.provider !== 'GITHUB' && eligibleIds.has(item.id))
      .map(({ id, name }) => ({ value: id, description: name })))
    : undefined);
  if (!connectionId) {
    terminal.writeError('Select a verified connection with an active grant for this plan.');
    return 1;
  }
  const connection = await operations.getConnection(connectionId);
  if (connection.status !== 'VERIFIED' || !grants.some(grant => grant.connectionId === connection.id && grant.status === 'ACTIVE')) {
    terminal.writeError('A verified connection and active grant for this plan are required.');
    return 1;
  }
  if (connection.provider === 'GITHUB') {
    terminal.writeError('Use inheriti automations usage for GitHub Actions.');
    return 1;
  }
  const bundle = generateAutomationRuntimeBundle({
    planId: options['--plan'], connection,
    mappings,
  });
  if (connection.provider === 'PORTABLE') {
    if (['--project', '--region', '--job', '--cluster', '--service',
      '--task-definition', '--container', '--script-path', '--apply', '--image', '--cli-path', '--expect-revision'].some(key => options[key])) {
      terminal.writeError(usage);
      return 1;
    }
    renderJson(terminal, {
      status: 'manual_setup_required', provider: bundle.provider,
      environment: bundle.environment,
      mappings,
      requiredEnvironment: bundle.requiredEnvironment,
      instructions: bundle.instructions,
    });
    terminal.write('--- Launcher script (save as an executable file) ---');
    terminal.write(bundle.script);
    return 0;
  }
  if (!['--project', '--region', '--job', '--cluster', '--service', '--task-definition', '--container'].some(key => options[key]) &&
      !applying && !options['--image'] && !options['--expect-revision']) {
    renderJson(terminal, { status: 'manual_setup_required', provider: bundle.provider,
      environment: bundle.environment, mappings, requiredEnvironment: bundle.requiredEnvironment,
      instructions: bundle.instructions });
    terminal.write('--- Launcher script (save as an executable file) ---');
    terminal.write(bundle.script);
    return 0;
  }
  const provider = cliAutomationProvider(connection.provider);
  const target = provider?.target(options);
  if (!target ||
      (applying && target.provider === 'AWS' && !('service' in target))) {
    terminal.writeError(usage);
    return 1;
  }
  const inspected = await inspectCloudTarget(target);
  if (connection.trust.method === 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC' &&
      inspected.identityNumericId !== connection.trust.serviceAccountSubject) {
    terminal.writeError('The Cloud Run service account does not match the verified connection.');
    return 1;
  }
  if (connection.trust.method === 'AWS_IAM_ROLE' && inspected.identity !== connection.trust.roleArn) {
    terminal.writeError('The ECS task role does not match the verified connection.');
    return 1;
  }
  if (applying) {
    const preview = previewCloudTarget(inspected, cliPath, Object.keys(bundle.environment));
    if (options['--expect-revision'] && inspected.revision !== options['--expect-revision']) {
      terminal.writeError('The workload revision changed. Preview it again before applying.');
      return 1;
    }
    if (bulk || !options['--expect-revision']) {
      renderJson(terminal, { status: 'awaiting_confirmation', preview, image: options['--image'],
        mappings,
        imagePreparation: `The immutable image must already include the Inheriti CLI at ${cliPath}.` });
      const confirmation = await promptSelect('Apply this cloud workload update?', [
        { value: 'cancel', description: 'Cancel' },
        { value: 'apply', description: `Apply revision ${inspected.revision}` },
      ]);
      if (confirmation !== 'apply') return 1;
    }
    const shared = {
      target, expectedRevision: options['--expect-revision'] ?? inspected.revision, planId: options['--plan'],
      mappings, image: options['--image']!,
      cliPath, environment: bundle.environment,
    };
    const result = await provider!.apply(shared, connection.trust, inspected.identity);
    renderJson(terminal, { ...result, imagePreparation: `The immutable image must already include the Inheriti CLI at ${cliPath}.` });
    return 0;
  }
  const preview = previewCloudTarget(inspected, options['--script-path'] ?? cliPath, Object.keys(bundle.environment));
  renderJson(terminal, {
    status: 'preview_only', preview,
    mappings,
    environment: bundle.environment,
    requiredEnvironment: bundle.requiredEnvironment,
    instructions: bundle.instructions,
  });
  terminal.write('--- Launcher script (save as an executable file) ---');
  terminal.write(bundle.script);
  return 0;
}
