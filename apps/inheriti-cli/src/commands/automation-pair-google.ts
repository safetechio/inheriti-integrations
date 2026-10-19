import { createAutomationSetupOperations, inspectCloudTargetForPairing, pairCloudRunAutomation } from '@safetech/inheriti-elements-core/node-base';
import type { CliConfiguration } from '../configuration.js';
import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';
import { renderJson } from '../output.js';
import { promptSelect } from '../render/select.js';

const allowed = new Set(['--connection', '--project', '--region', '--service', '--job', '--expect-revision']);
const usage = 'Usage: inheriti automations pair google --connection ID --project PROJECT --region REGION (--service SERVICE | --job JOB) [--expect-revision GENERATION]';

export async function pairGoogleAutomationWorkload(
  context: CliContext, configuration: CliConfiguration, terminal: Terminal, argv: readonly string[],
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();
  const entries = argv.filter((_, index) => index % 2 === 0).map((key, index) => [key, argv[index * 2 + 1]] as const);
  const options = Object.fromEntries(entries) as Record<string, string>;
  if (argv.length % 2 || entries.some(([key, value]) => !allowed.has(key) || !value || value.startsWith('--')) ||
      Object.keys(options).length !== entries.length || !options['--connection'] || !options['--project'] ||
      !options['--region'] || !!options['--service'] === !!options['--job'] ||
      (!terminal.interactive && !options['--expect-revision'])) {
    terminal.writeError(usage);
    return 1;
  }
  if (!(await context.core.getAccessToken())) { terminal.writeError('Sign in before pairing automation.'); return 1; }
  const operations = createAutomationSetupOperations({
    apiUrl: configuration.apiUrl, organizationId: context.organization!.id,
    getBearerToken: () => context.core.getAccessToken(),
  });
  const connection = await operations.getConnection(options['--connection']);
  if (connection.provider !== 'GOOGLE_CLOUD' || connection.trust.method !== 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC' ||
      connection.status === 'DISABLED') {
    terminal.writeError('Select a Google Cloud connection that is awaiting verification.');
    return 1;
  }
  const target = options['--service']
    ? { provider: 'GOOGLE_CLOUD' as const, project: options['--project'], region: options['--region'], service: options['--service'] }
    : { provider: 'GOOGLE_CLOUD' as const, project: options['--project'], region: options['--region'], job: options['--job']! };
  const inspected = await inspectCloudTargetForPairing(target);
  if (inspected.identityNumericId !== connection.trust.serviceAccountSubject) {
    terminal.writeError('The Cloud Run service account does not match this connection.');
    return 1;
  }
  if (options['--expect-revision'] && options['--expect-revision'] !== inspected.revision) {
    terminal.writeError('The Cloud Run workload changed. Inspect it again before pairing.');
    return 1;
  }
  if (!options['--expect-revision']) {
    renderJson(terminal, { target, generation: inspected.revision, serviceAccount: inspected.identity,
      action: 'Run one temporary Cloud Run job to verify this connection.' });
    const choice = await promptSelect('Run this one-off Cloud Run job?', [
      { value: 'cancel', description: 'Cancel' }, { value: 'run', description: 'Start pairing and run job' },
    ], signal);
    if (choice !== 'run') return 1;
  }
  const result = await pairCloudRunAutomation({
    target, expectedRevision: inspected.revision, expectedSubject: connection.trust.serviceAccountSubject,
    environment: {
      INHERITI_AUTOMATION_PROVIDER: 'GOOGLE_CLOUD',
      INHERITI_AUTOMATION_CONNECTION_ID: connection.id,
      INHERITI_AUTOMATION_AUDIENCE: connection.trust.audience,
    },
    startPairing: async () => { await operations.startPairing(connection.id); },
    ...(signal ? { signal } : {}),
  });
  const verified = await operations.getConnection(connection.id);
  if (verified.status !== 'VERIFIED') {
    terminal.writeError('The Cloud Run job finished, but Business has not confirmed the connection. Check its status before proceeding.');
    return 1;
  }
  renderJson(terminal, { ...result, connectionId: connection.id, connectionStatus: verified.status });
  return 0;
}
