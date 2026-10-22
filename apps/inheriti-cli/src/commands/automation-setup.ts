import {
  createAutomationSetupOperations,
  generateAutomationRuntimeBundle,
  inspectEc2AutomationInstance,
  installEc2AutomationService,
  inspectCloudTarget,
  prepareEc2AutomationService,
  previewCloudTarget,
  resolveAutomationFieldMappings,
  resolveAutomationImage,
} from '@safetech/inheriti-elements-core/node-base';
import type { CliConfiguration } from '../configuration.js';
import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';
import { renderJson } from '../output.js';
import { promptSelect } from '../render/select.js';
import { promptText } from '../render/select.js';
import { chmod, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { cliAutomationProvider } from './automation-provider.js';

const usage = [
  'Usage: inheriti automations setup --plan PLAN_ID [--connection CONNECTION_ID]',
  '  (--map-all [--except ASSET.FIELD ...] | --only ASSET.FIELD ... | --map NAME=ASSET.FIELD ... | --field ASSET.FIELD --env-name NAME)',
  '  [--map NAME=ASSET.FIELD ...]  Override generated names when using --map-all or --only.',
  '  [--project PROJECT --region REGION (--job JOB | --service SERVICE)',
  '  | --region REGION --cluster CLUSTER (--service SERVICE | --task-definition ARN)]',
  '  [--container NAME] [--script-path ABSOLUTE_PATH]',
  '  Manual container setup: [--save RELATIVE_PATH] (inside the Docker build context)',
  '  [--cli-path ABSOLUTE_PATH] [--apply --image IMAGE [--expect-revision REVISION]]',
  '  EC2: --region REGION --instance INSTANCE_ID --service-name NAME --run-as-user USER [--script-path PATH] [--install [--replace]] -- APP_COMMAND [ARGS...]',
  '  CLI path defaults to /usr/local/bin/inheriti.',
].join('\n');
const allowed = new Set([
  '--plan', '--connection', '--field', '--env-name', '--map', '--map-all', '--only', '--except', '--project', '--region',
  '--job', '--cluster', '--service', '--task-definition', '--container', '--script-path',
  '--save',
  '--instance', '--service-name', '--run-as-user',
  '--apply', '--install', '--replace', '--image', '--cli-path', '--expect-revision',
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
    if (key === '--install' || key === '--replace' || ((key === '--apply' || key === '--map-all') &&
        (argv[index + 1] === undefined || argv[index + 1]?.startsWith('--')))) {
      options[key] = 'true';
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) return;
    options[key] = value;
  }
  const consumed = Object.keys(options).length * 2 - ['--apply', '--map-all', '--install', '--replace'].filter(key => options[key] === 'true').length;
  return consumed + (mappings.length + onlyFields.length + exceptFields.length) * 2 === argv.length
    ? { options, mappings, onlyFields, exceptFields } : undefined;
}

export async function automationSetup(
  context: CliContext,
  configuration: CliConfiguration,
  terminal: Terminal,
  argv: readonly string[],
): Promise<number> {
  const separator = argv.indexOf('--');
  const applicationCommand = separator < 0 ? [] : argv.slice(separator + 1);
  const parsed = parse(separator < 0 ? argv : argv.slice(0, separator));
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
  if (options['--save'] && (options['--instance'] || applying || applicationCommand.length ||
      ['--project', '--region', '--job', '--cluster', '--service', '--task-definition', '--container', '--script-path'].some(key => options[key]))) {
    terminal.writeError('--save is only available for manual container setup.');
    return 1;
  }
  if (options['--replace'] && !options['--install']) {
    terminal.writeError('--replace requires --install on EC2.');
    return 1;
  }
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
      '--task-definition', '--container', '--script-path', '--save', '--apply', '--install', '--replace', '--image', '--cli-path', '--expect-revision'].some(key => options[key])) {
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
  if (options['--instance']) {
    if (connection.provider !== 'AWS' || connection.trust.method !== 'AWS_IAM_ROLE' ||
        !options['--region'] || !options['--service-name'] || !options['--run-as-user'] ||
        !applicationCommand.length || applying || options['--image'] || options['--expect-revision'] ||
        options['--cli-path'] || ['--project', '--job', '--cluster', '--service', '--task-definition', '--container'].some(key => options[key])) {
      terminal.writeError(usage);
      return 1;
    }
    const instance = await inspectEc2AutomationInstance({ region: options['--region'], instanceId: options['--instance'] });
    if (instance.roleArn !== connection.trust.roleArn) {
      terminal.writeError('The EC2 instance role does not match the verified connection.');
      return 1;
    }
    const prepared = prepareEc2AutomationService({
      bundle: { ...bundle, environment: { ...bundle.environment, AWS_REGION: instance.region } },
      applicationCommand: [...applicationCommand], serviceName: options['--service-name'],
      runAsUser: options['--run-as-user'], launcherPath: options['--script-path'] ?? '/usr/local/bin/inheriti-automation',
    });
    if (options['--install']) {
      if (!terminal.interactive) {
        terminal.writeError('EC2 installation requires an interactive terminal to review and confirm the target.');
        return 1;
      }
      terminal.write(`EC2 instance: ${instance.instanceId} (${instance.region})`);
      terminal.write(`IAM role: ${instance.roleArn}`);
      terminal.write(`Plan fields: ${mappings.map(item => `${item.envName}=${item.selector}`).join(', ')}`);
      terminal.write(`Launcher: ${options['--script-path'] ?? '/usr/local/bin/inheriti-automation'}`);
      terminal.write(`Run script: ${prepared.runScriptPath}`);
      terminal.write(`Systemd unit: /etc/systemd/system/${prepared.unitName} (run as ${options['--run-as-user']})`);
      terminal.write(`Application command: ${applicationCommand.join(' ')}`);
      terminal.write(options['--replace']
        ? 'The stopped service run script will be replaced. A matching older Inheriti unit will also be updated.'
        : 'Existing files will not be replaced. The service will not be enabled or started.');
      const confirmation = await promptSelect(options['--replace']
        ? 'Update the stopped EC2 installation using AWS Systems Manager?'
        : 'Install these files on the EC2 instance using AWS Systems Manager?', [
        { value: 'cancel', description: 'Cancel' },
        { value: 'install', description: options['--replace'] ? 'Update installation' : 'Install files and reload systemd' },
      ]);
      if (confirmation !== 'install') return 1;
      const result = await installEc2AutomationService({ region: instance.region, instanceId: instance.instanceId,
        runAsUser: options['--run-as-user'], launcherPath: options['--script-path'] ?? '/usr/local/bin/inheriti-automation',
        launcher: bundle.script, prepared, applicationCommand: [...applicationCommand], replace: !!options['--replace'] });
      terminal.write(`${options['--replace'] ? 'Updated' : 'Installed'} ${result.unitName} on ${instance.instanceId}. Review the existing application service, then enable and start this unit when ready.`);
      return 0;
    }
    renderJson(terminal, { status: 'installation_required', instanceId: instance.instanceId,
      roleArn: instance.roleArn, mappings, runScriptPath: prepared.runScriptPath,
      unitName: prepared.unitName, instructions: prepared.instructions });
    terminal.write('--- Launcher script ---');
    terminal.write(bundle.script);
    terminal.write('--- Application run script ---');
    terminal.write(prepared.runScript);
    terminal.write('--- systemd unit ---');
    terminal.write(prepared.unit);
    return 0;
  }
  if (applicationCommand.length || options['--service-name'] || options['--run-as-user'] || options['--install']) {
    terminal.writeError(usage);
    return 1;
  }
  if (!['--project', '--region', '--job', '--cluster', '--service', '--task-definition', '--container'].some(key => options[key]) &&
      !applying && !options['--image'] && !options['--expect-revision']) {
    renderJson(terminal, { status: 'manual_setup_required', provider: bundle.provider,
      environment: bundle.environment, mappings, requiredEnvironment: bundle.requiredEnvironment,
      instructions: bundle.instructions });
    const choice = options['--save'] ? 'save' : terminal.interactive
      ? await promptSelect('How should the launcher be delivered?', [
        { value: 'print', description: 'Print script' },
        { value: 'save', description: 'Save as a file in this app project' },
      ]) : 'print';
    if (!choice) return 1;
    if (choice === 'print') {
      terminal.write('--- Launcher script (save as an executable file) ---');
      terminal.write(bundle.script);
      return 0;
    }
    const source = options['--save'] ?? await promptText('Save launcher as (relative to this Docker build context):');
    if (!source || isAbsolute(source) || source === '.' || source === '..' || /[\0\[\]*?]/u.test(source)) {
      terminal.writeError('Choose a relative file path inside the current Docker build context without Docker COPY wildcard characters.');
      return 1;
    }
    try {
      const base = await realpath(process.cwd());
      const destination = resolve(base, source);
      const inside = relative(base, destination);
      const parent = relative(base, await realpath(resolve(destination, '..')));
      if (!inside || inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside) ||
          parent.startsWith(`..${sep}`) || parent === '..' || isAbsolute(parent)) {
        terminal.writeError('Choose an existing directory inside the current Docker build context.');
        return 1;
      }
      await writeFile(destination, bundle.script.endsWith('\n') ? bundle.script : `${bundle.script}\n`, { flag: 'wx', mode: 0o755 });
      await chmod(destination, 0o755);
      const dockerSource = `./${inside.split(sep).join('/')}`;
      terminal.write(`Saved launcher: ${inside}`);
      terminal.write('Add to your Dockerfile:');
      terminal.write(`COPY ${JSON.stringify([dockerSource, '/usr/local/bin/inheriti-automation'])}`);
      terminal.write('RUN chmod +x /usr/local/bin/inheriti-automation');
      terminal.write('ENTRYPOINT ["/usr/local/bin/inheriti-automation"]');
      terminal.write('Keep the complete application executable and arguments in image CMD, ECS command, or Cloud Run args. Remove any ECS entryPoint or Cloud Run command override that bypasses this launcher (or set it to the launcher). Then deploy with your usual pipeline.');
    } catch (error) {
      terminal.writeError(`Could not save launcher: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
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
    const image = await resolveAutomationImage(options['--image']!, target.provider);
    if (bulk || !options['--expect-revision']) {
      renderJson(terminal, { status: 'awaiting_confirmation', preview, image,
        mappings,
        imagePreparation: 'Publish an image containing Inheriti CLI before applying. The supplied image is pinned to the digest shown here.' });
      const confirmation = await promptSelect('Apply this cloud workload update?', [
        { value: 'cancel', description: 'Cancel' },
        { value: 'apply', description: `Apply revision ${inspected.revision}` },
      ]);
      if (confirmation !== 'apply') return 1;
    }
    const shared = {
      target, expectedRevision: options['--expect-revision'] ?? inspected.revision, planId: options['--plan'],
      mappings, image,
      cliPath, environment: bundle.environment,
    };
    const result = await provider!.apply(shared, connection.trust, inspected.identity);
    renderJson(terminal, { ...result, image, imagePreparation: 'The supplied image was pinned to the digest shown here; image contents were not checked.' });
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
