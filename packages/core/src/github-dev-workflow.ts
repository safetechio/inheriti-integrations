import { AutomationProviderValue } from './automation-provider.js';
import { isGithubAutomationSelector } from './automation-setup.js';

type DevWorkflowInput = { environment: string; planId: string; connectionId: string; selector: string;
  artifact: { cliVersion: string; sha256: string; downloadOrigin: string } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEV_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-dev\.(0|[1-9]\d*)$/;

export function githubDevArtifactSecretName(connectionId: string): string {
  if (!UUID.test(connectionId)) throw new Error('Invalid GitHub DEV workflow input');
  return `INHERITI_DEV_CLI_${connectionId.replaceAll('-', '').toUpperCase()}`;
}

export function githubAutomationDevWorkflow(input: DevWorkflowInput): string {
  const { environment, planId, connectionId, selector, artifact } = input;
  let origin: URL;
  try { origin = new URL(artifact.downloadOrigin); } catch { throw new Error('Invalid GitHub DEV workflow input'); }
  if (!environment.trim() || /[\r\n\x00-\x1f\x7f]/.test(environment) || environment.length > 255 ||
      !UUID.test(planId) || !UUID.test(connectionId) || !isGithubAutomationSelector(selector) ||
      !DEV_VERSION.test(artifact.cliVersion) || !/^[0-9a-f]{64}$/i.test(artifact.sha256) ||
      origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' ||
      origin.search || origin.hash || artifact.downloadOrigin !== origin.origin)
    throw new Error('Invalid GitHub DEV workflow input');
  const secret = githubDevArtifactSecretName(connectionId);
  const expectedAudience = AutomationProviderValue.from('GITHUB').expectedAudience(connectionId)!;
  const canonical: DevWorkflowInput = { environment, planId, connectionId, selector,
    artifact: { cliVersion: artifact.cliVersion, sha256: artifact.sha256.toLowerCase(), downloadOrigin: origin.origin } };
  const install = [
    '      - name: Install verified DEV CLI artifact',
    '        env:', `          INHERITI_DEV_CLI_URL: \${{ secrets.${secret} }}`,
    '        run: |', "          node --input-type=module <<'NODE'",
    "          import { createHash } from 'node:crypto';",
    "          import { writeFileSync } from 'node:fs';",
    '          try {',
    '            const url = new URL(process.env.INHERITI_DEV_CLI_URL || "");',
    `            if (url.protocol !== 'https:' || url.origin !== ${JSON.stringify(origin.origin)} || url.username || url.password) throw Error();`,
    "            const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(60000) });",
    '            if (response.status !== 200 || !response.body) throw Error();',
    '            const chunks = []; let size = 0;',
    '            for await (const chunk of response.body) { size += chunk.length; if (size > 33554432) throw Error(); chunks.push(chunk); }',
    '            const bytes = Buffer.concat(chunks);',
    `            if (createHash('sha256').update(bytes).digest('hex') !== '${canonical.artifact.sha256}') throw Error();`,
    "            writeFileSync('/tmp/inheriti-cli.tgz', bytes, { mode: 0o600 });",
    "          } catch { console.error('DEV CLI artifact validation failed'); process.exitCode = 1; }",
    '          NODE',
    '          npm install --global --engine-strict /tmp/inheriti-cli.tgz',
    `          test "$(inheriti --version)" = '${artifact.cliVersion}'`,
  ];
  return [
    `# inheriti-dev-workflow: ${JSON.stringify(canonical)}`,
    'name: Inheriti DEV automation',
    "run-name: ${{ inputs.pair_inheriti && format('Inheriti pairing {0}', inputs.pairing_attempt) || 'Inheriti DEV usage' }}",
    'on:', '  push:', '    paths:', "      - '.github/workflows/**'", '  workflow_dispatch:', '    inputs:', '      pair_inheriti:', '        type: boolean', '        default: false',
    '      pairing_attempt:', '        type: string', '        required: false',
    'permissions:', '  contents: read', '  id-token: write', 'jobs:',
    '  pair-inheriti:', "    if: ${{ github.event_name == 'workflow_dispatch' && inputs.pair_inheriti }}", '    runs-on: ubuntu-latest', '    container: node:22-bookworm-slim',
    `    environment: ${JSON.stringify(environment)}`, '    steps:', ...install,
    '      - name: Redeem pairing proof', '        env:', `          INHERITI_AUTOMATION_CONNECTION_ID: ${JSON.stringify(connectionId)}`,
    `          INHERITI_AUTOMATION_AUDIENCE: ${JSON.stringify(expectedAudience)}`,
    '        run: inheriti automations pair redeem',
    '  use-secret:', "    if: ${{ github.event_name == 'workflow_dispatch' && !inputs.pair_inheriti }}", '    runs-on: ubuntu-latest', '    container: node:22-bookworm-slim',
    `    environment: ${JSON.stringify(environment)}`, '    steps:', ...install,
    '      - name: Use protected plan field', '        env:', `          INHERITI_AUTOMATION_CONNECTION_ID: ${JSON.stringify(connectionId)}`,
    `          INHERITI_AUTOMATION_AUDIENCE: ${JSON.stringify(expectedAudience)}`,
    `        run: ${JSON.stringify(`inheriti secrets exec ${planId} --automation --env INHERITI_SECRET=${selector} -- sh -c 'test -n "$INHERITI_SECRET"'`)}`,
  ].join('\n') + '\n';
}

export function isManagedGithubDevWorkflow(text: string, connectionId: string): boolean {
  if (!UUID.test(connectionId)) return false;
  const first = text.split('\n', 1)[0];
  if (!first?.startsWith('# inheriti-dev-workflow: ') || first.length > 4096) return false;
  try {
    const input = JSON.parse(first.slice('# inheriti-dev-workflow: '.length)) as DevWorkflowInput;
    return input.connectionId === connectionId && githubAutomationDevWorkflow(input) === text;
  } catch { return false; }
}
