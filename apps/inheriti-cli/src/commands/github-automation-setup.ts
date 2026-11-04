import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { createAutomationSetupOperations, githubAutomationWorkflow, githubAutomationWorkflowLocation, githubAutomationDevWorkflow, isManagedGithubDevWorkflow, githubDevArtifactSecretName, isGithubAutomationSelector, resolveAutomationFieldMappings } from '@safetech/inheriti-elements-core/node-base';
import type { AutomationSetupOperations } from '@safetech/inheriti-elements-core/node-base';
import { BUILD_DEPLOYMENT, type CliConfiguration } from '../configuration.js';
import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';
import { promptSelect } from '../render/select.js';
import { createGithubSetupPresenter } from '../render/github-setup.js';
import { pairGithubWorkflow } from './github-workflow-pairing.js';
import { loadGithubDevArtifact, uploadGithubDevArtifact } from './github-dev-artifact.js';
import { connectionChoice, operationalConnections } from './automation-choices.js';

const usage = 'Usage: inheriti automations setup github --connection ID --plan ID --field ASSET.FIELD [--apply] [--retry]';
const createUsage = 'Usage: inheriti automations create github [--repository OWNER/REPO] [--environment GH_ENV] [--workflow FILE.yml]';
const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const workflowPattern = /^[A-Za-z0-9_.-]+\.ya?ml$/;
const branchPattern = /^[A-Za-z0-9._/-]+$/;
const urlNamespace = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');
function connectionIdFor(apiUrl: string, organizationId: string, trust: object): string {
  const bytes = createHash('sha1').update(urlNamespace).update(`${apiUrl}\0${organizationId}\0${JSON.stringify(trust)}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
type Gh = (args: string[], body?: unknown) => Promise<unknown>;

async function preflight(run: Gh): Promise<void> {
  try { await run(['--version']); }
  catch { throw new Error('gh_cli_required: install GitHub CLI (gh) before continuing.'); }
  try { await run(['auth', 'status']); }
  catch { throw new Error('gh_authentication_required: sign in with gh auth login so Inheriti can inspect and update the selected GitHub repository.'); }
  const headers = await run(['api', 'user', '--include']).catch(() => undefined);
  if (typeof headers === 'string') {
    const scopes = [...headers.matchAll(/^x-oauth-scopes:\s*([^\r\n]*)/gim)].at(-1)?.[1];
    if (scopes?.trim() && !scopes.split(',').some(scope => scope.trim().toLowerCase() === 'workflow'))
      throw new Error('gh_workflow_scope_required: GitHub requires the workflow scope to create or update the Inheriti workflow in this repository. Run gh auth refresh -h github.com -s workflow.');
  }
}

const gh: Gh = (args, body) => new Promise((resolve, reject) => {
  const child = spawn('gh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let error = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { error += chunk; });
  child.on('error', reject);
  child.on('close', code => {
    if (code !== 0) return reject(new Error(args[0] === 'secret' ? 'GitHub secret update failed.' : `GitHub command failed (${code}): ${error.trim().slice(0, 240)}`));
    if (args[0] === 'workflow' || args[0] === '--version' || args[0] === 'auth' || args[0] === 'secret') return resolve(undefined);
    if (args[0] === 'api' && args[1] === 'user' && args.includes('--include')) return resolve(output);
    try { resolve(output.trim() ? JSON.parse(output) : undefined); } catch { reject(new Error('Invalid GitHub response')); }
  });
  child.stdin.end(body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body));
});

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid GitHub response');
  return value as Record<string, unknown>;
}
function value(object: Record<string, unknown>, key: string): string {
  if (typeof object[key] !== 'string' || !object[key]) throw new Error('Invalid GitHub response');
  return object[key] as string;
}
async function api(run: Gh, path: string, method?: string, body?: unknown): Promise<Record<string, unknown>> {
  return record(await run(['api', path, ...(method ? ['--method', method, '--input', '-'] : [])], body));
}

export async function githubAutomationSetup(
  context: CliContext, configuration: CliConfiguration, terminal: Terminal, argv: readonly string[],
  dependencies: { run?: Gh; operations?: AutomationSetupOperations; wait?: (ms: number) => Promise<void>; select?: typeof promptSelect } = {},
): Promise<number> {
  let options: { plan?: string; field?: string; connection?: string; apply?: boolean; retry?: boolean };
  try {
    options = parseArgs({ args: [...argv], options: {
      plan: { type: 'string' }, field: { type: 'string' }, connection: { type: 'string' }, apply: { type: 'boolean' }, retry: { type: 'boolean' },
    }, strict: true }).values as typeof options;
  } catch { terminal.writeError(usage); return 1; }
  if ((!terminal.interactive && (!options.plan || !options.field || !options.connection)) ||
      (options.field && !isGithubAutomationSelector(options.field))) {
    terminal.writeError(usage); return 1;
  }
  const run = dependencies.run ?? gh;
  const operations = dependencies.operations ?? createAutomationSetupOperations({ apiUrl: configuration.apiUrl,
    organizationId: context.organization!.id, getBearerToken: () => context.core.getAccessToken() });
  try {
    terminal.write('Checking GitHub CLI, access and repository…');
    await preflight(run);
    if (!(await context.core.getAccessToken())) throw new Error('Sign in before preparing automation.');
    const select = dependencies.select ?? promptSelect;
    const plan = options.plan ?? await select('Which protected plan?', (await operations.listPlans()).map(item => ({ value: item.id, description: item.name ?? item.title ?? item.id })));
    if (!plan) throw new Error('Plan required.');
    const selectedPlan = await context.core.getPlan(plan);
    const field = options.field ?? await select('Which plan field?', resolveAutomationFieldMappings(selectedPlan.assets, { mapAll: true })
      .map(item => ({ value: item.selector, description: item.selector })));
    if (!field) throw new Error('Plan field required.');
    if (!resolveAutomationFieldMappings(selectedPlan.assets, { onlyFields: [field], mappings: [] }).length)
      throw new Error('Selected field is not available in the plan.');
    const connectionId = options.connection ?? await select('Which GitHub connection?', operationalConnections(await operations.listConnections())
      .filter(item => item.provider === 'GITHUB' && ['PENDING_VERIFICATION', 'VERIFIED'].includes(item.status))
      .map(item => ({ value: item.id, description: connectionChoice(item).name })));
    if (!connectionId) throw new Error('GitHub connection required.');
    const selected = await operations.getConnection(connectionId);
    if (selected.provider !== 'GITHUB' || selected.environment !== 'TEST' ||
        selected.trust.method !== 'GITHUB_ACTIONS_OIDC' || !['PENDING_VERIFICATION', 'VERIFIED'].includes(selected.status))
      throw new Error('Selected GitHub connection is not pending or verified.');
    const { repository: repositoryName, path, branch } = githubAutomationWorkflowLocation(selected.trust.repositoryName, selected.trust.workflow);
    const environment = selected.trust.environment;
    let currentRepository: string;
    try { currentRepository = value(record(await run(['repo', 'view', '--json', 'nameWithOwner'])), 'nameWithOwner'); }
    catch { throw new Error('Run this inside the repository linked to the selected connection.'); }
    if (currentRepository.toLowerCase() !== repositoryName.toLowerCase())
      throw new Error('Current repository does not match the selected connection.');
    // The release gate precedes every write, including repository initialization.
    const devArtifact = BUILD_DEPLOYMENT === 'dev' && configuration.deployment === 'dev' ? await loadGithubDevArtifact() : undefined;
    const release = devArtifact ? undefined : await operations.getVerifiedGithubRelease();
    const repo = await api(run, `repos/${repositoryName}`);
    if (typeof repo.full_name !== 'string' || repo.full_name.toLowerCase() !== repositoryName.toLowerCase() || repo.archived === true || repo.disabled === true)
      throw new Error('Selected GitHub repository identity could not be verified.');
    if (!repo.permissions || record(repo.permissions).push !== true)
      throw new Error('GitHub repository write permission is required to commit the Inheriti workflow. Check repository access for the current gh account.');
    if (branch !== value(repo, 'default_branch')) throw new Error('Initial manual dispatch requires the repository default branch.');
    const yaml = devArtifact ? githubAutomationDevWorkflow({ environment, planId: plan, connectionId, selector: field,
      artifact: { cliVersion: devArtifact.profile.cliVersion, sha256: devArtifact.profile.sha256, downloadOrigin: devArtifact.profile.downloadOrigin } })
      : githubAutomationWorkflow({ release: release!, environment, planId: plan, connectionId, selector: field, includePairing: true });
    let existing: Record<string, unknown> | undefined;
    let empty = false;
    try { existing = await api(run, `repos/${repositoryName}/contents/${path}?ref=${encodeURIComponent(branch)}`); }
    catch (error) {
      if (!String(error).includes('404')) throw error;
      try { await api(run, `repos/${repositoryName}/git/ref/heads/${encodeURIComponent(branch)}`); }
      catch (refError) { if (!String(refError).includes('404')) throw refError; empty = true; }
    }
    const existingText = existing?.encoding === 'base64' && typeof existing.content === 'string'
      ? Buffer.from(existing.content, 'base64').toString('utf8') : undefined;
    const replaceOwnedDev = !!devArtifact && !!existingText && existingText !== yaml && isManagedGithubDevWorkflow(existingText, connectionId);
    if (existing && (!existingText || existingText !== yaml && !replaceOwnedDev))
      throw new Error(`Workflow ${path} already exists with different content; refusing to overwrite it.`);
    terminal.write(`GitHub setup: ${repositoryName}/${path}@${branch}; environment ${environment}; plan ${plan}; field ${field}.`);
    terminal.write(`Use ${selected.status.toLowerCase()} connection ${connectionId}; ${replaceOwnedDev ? 'update pristine generated DEV workflow' : existing ? 'reuse generated workflow' : empty ? 'initialize empty repository with generated workflow' : 'commit generated workflow'}; ${selected.status === 'VERIFIED' ? 'skip pairing' : 'dispatch pairing-only job'}.`);
    terminal.write('Apply may commit to the default branch and, if identity is pending, dispatch the pairing job. A commit can trigger existing push workflows. Protected usage is not dispatched.');
    if (!options.apply && (!terminal.interactive || await select('Apply this GitHub workflow setup?', [
      { value: 'no', description: 'No, preview only' }, { value: 'yes', description: 'Commit workflow and pair identity' },
    ]) !== 'yes')) return 0;
    const prepare = async () => {
      if (devArtifact) {
        const signedUrl = await uploadGithubDevArtifact(devArtifact);
        await putWorkflow();
        await run(['secret', 'set', githubDevArtifactSecretName(connectionId), '--repo', repositoryName], Buffer.from(signedUrl));
      } else {
        await putWorkflow();
      }
    };
    const putWorkflow = async () => {
      let current: Record<string, unknown> | undefined;
      try { current = await api(run, `repos/${repositoryName}/contents/${path}?ref=${encodeURIComponent(branch)}`); }
      catch (error) { if (!String(error).includes('404')) throw error; }
      const currentText = current?.encoding === 'base64' && typeof current.content === 'string'
        ? Buffer.from(current.content, 'base64').toString('utf8') : undefined;
      if (currentText === yaml) return;
      if (current && (!currentText || !devArtifact || !isManagedGithubDevWorkflow(currentText, connectionId)))
        throw new Error(`Workflow ${path} changed during setup; refusing to overwrite it.`);
      await api(run, `repos/${repositoryName}/contents/${path}`, 'PUT', {
        message: 'Add Inheriti automation workflow', content: Buffer.from(yaml).toString('base64'),
        ...(!empty ? { branch } : {}),
        ...(current ? { sha: value(current, 'sha') } : {}),
      });
    };
    const progressLabels = { preparing: 'Preparing workflow and local package…', registering: 'Waiting for GitHub to register the workflow…',
      pairing: 'Opening identity pairing window…', queued: 'Dispatching pairing job…', running: 'Pairing job running…',
      verifying: 'Verifying connection identity…', verified: 'Connection verified.' };
    const pair = async (retry: boolean) => {
      const presenter = createGithubSetupPresenter(terminal, repositoryName);
      const shownProgress = new Set<string>();
      try {
        return await pairGithubWorkflow({ apiUrl: configuration.apiUrl, organizationId: context.organization!.id,
          connectionId, repository: repositoryName, workflowPath: path, ref: branch, runGh: run, operations,
          workflowDigest: createHash('sha256').update(yaml).digest('hex'), prepare,
          onProgress: phase => {
            if (presenter) presenter.progress(progressLabels[phase]);
            else if (!shownProgress.has(phase)) { terminal.write(progressLabels[phase]); shownProgress.add(phase); }
          },
          onRun: runId => presenter?.run(runId),
          retry, ...(dependencies.wait ? { wait: dependencies.wait } : {}) });
      } finally { presenter?.close(); }
    };
    try { await pair(options.retry === true); }
    catch (error) {
      if (!terminal.interactive || options.retry || !(error instanceof Error) || error.message !== 'github_pairing_failed_retry_required' ||
          await select('Pairing failed or expired. Start a new attempt?', [
            { value: 'no', description: 'No, keep existing attempt' }, { value: 'yes', description: 'Start one new pairing attempt' },
          ]) !== 'yes') throw error;
      await pair(true);
    }
    terminal.write(`Ready: verified connection ${connectionId}, generated workflow ${path}. Grant plan access with the separate grant commands before running protected usage.`);
    return 0;
  } catch (error) { terminal.writeError(error instanceof Error && error.message === 'github_pairing_pending'
    ? 'Pairing is still in progress. Rerun the same setup command to resume; no new connection or job is needed.'
    : error instanceof Error ? error.message : 'GitHub setup failed.'); return 1; }
}

export async function githubAutomationCreate(
  context: CliContext, configuration: CliConfiguration, terminal: Terminal, argv: readonly string[],
  dependencies: { run?: Gh; operations?: AutomationSetupOperations } = {},
): Promise<number> {
  let options: { repository?: string; environment?: string; workflow?: string };
  try {
    options = parseArgs({ args: [...argv], options: {
      repository: { type: 'string' }, environment: { type: 'string' }, workflow: { type: 'string' },
    }, strict: true }).values as typeof options;
  } catch { terminal.writeError(createUsage); return 1; }
  const environment = options.environment ?? 'inheriti';
  const filename = options.workflow ?? 'inheriti.yml';
  if ((options.repository && !repoPattern.test(options.repository)) || !workflowPattern.test(filename) ||
      !environment.trim() || /[\r\n]/.test(environment)) { terminal.writeError(createUsage); return 1; }
  const run = dependencies.run ?? gh;
  const operations = dependencies.operations ?? createAutomationSetupOperations({ apiUrl: configuration.apiUrl,
    organizationId: context.organization!.id, getBearerToken: () => context.core.getAccessToken() });
  try {
    await preflight(run);
    if (!(await context.core.getAccessToken())) throw new Error('Sign in before creating automation.');
    let repository = options.repository;
    if (!repository) {
      try { repository = value(record(await run(['repo', 'view', '--json', 'nameWithOwner'])), 'nameWithOwner'); }
      catch { throw new Error('Run this inside your repository or project folder, or pass --repository OWNER/REPO.'); }
    }
    if (!repoPattern.test(repository)) throw new Error('Could not identify the current GitHub repository.');
    const repo = await api(run, `repos/${repository}`);
    if (typeof repo.full_name !== 'string' || repo.full_name.toLowerCase() !== repository.toLowerCase() || repo.archived === true || repo.disabled === true)
      throw new Error('GitHub repository identity could not be verified.');
    const name = repo.full_name;
    const branch = value(repo, 'default_branch');
    if (!branchPattern.test(branch) || branch.includes('..')) throw new Error('Invalid repository default branch.');
    const trust = { method: 'GITHUB_ACTIONS_OIDC' as const, repositoryName: name, environment,
      workflow: `${name}/.github/workflows/${filename}@refs/heads/${branch}` };
    const matches = (await operations.listConnections()).filter(item => item.provider === 'GITHUB' && item.environment === 'TEST' &&
      item.trust.method === 'GITHUB_ACTIONS_OIDC' && item.trust.repositoryName === name && item.trust.environment === environment && item.trust.workflow === trust.workflow);
    const active = matches.filter(item => ['PENDING_VERIFICATION', 'VERIFIED'].includes(item.status));
    if (active.length > 1) throw new Error('Multiple active matching GitHub connections; select one explicitly for setup.');
    const disabledIds = matches.filter(item => !active.includes(item)).map(item => item.id).sort();
    const id = active[0]?.id ?? connectionIdFor(configuration.apiUrl, context.organization!.id,
      disabledIds.length ? { trust, disabledIds } : trust);
    if (!active.length) {
      try { await operations.createConnection({ id, name: `${name} Inheriti`, provider: 'GITHUB', environment: 'TEST', trust }); }
      catch (error) {
        const current = await operations.getConnection(id).catch(() => undefined);
        if (!current || current.provider !== 'GITHUB' || current.environment !== 'TEST' ||
            current.trust.method !== 'GITHUB_ACTIONS_OIDC' || current.trust.repositoryName !== name ||
            current.trust.environment !== environment || current.trust.workflow !== trust.workflow ||
            !['PENDING_VERIFICATION', 'VERIFIED'].includes(current.status)) throw error;
      }
    }
    terminal.write(`${active.length ? 'Reused' : 'Created'} GitHub connection ${id} for ${trust.workflow} (environment ${environment}). Use --connection ${id} for setup.`);
    return 0;
  } catch (error) { terminal.writeError(error instanceof Error ? error.message : 'GitHub connection creation failed.'); return 1; }
}
