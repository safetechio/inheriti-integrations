import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

type Gh = (args: string[], body?: unknown) => Promise<unknown>;
type Checkpoint = { pairingId: string; attemptId: string; phase: 'prepared' | 'started' | 'unknown' | 'running' | 'failed'; expiresAt?: string; runId?: number; workflowDigest?: string };
type PairOptions = { apiUrl: string; organizationId: string; connectionId: string; repository: string; workflowPath: string; ref: string;
  runGh: Gh; operations: { startPairing(id: string, pairingId?: string): Promise<{ expiresAt: string }>;
    getConnection(id: string): Promise<{ status: string }> }; retry?: boolean;
  stateDirectory?: string; now?: () => number; wait?: (ms: number) => Promise<void>; pollAttempts?: number;
  workflowDigest?: string; prepare?: () => Promise<void>; onProgress?: (phase: 'preparing' | 'registering' | 'pairing' | 'queued' | 'running' | 'verifying' | 'verified') => void;
  onRun?: (runId: number) => void };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('github_pairing_invalid_response');
  return value as Record<string, unknown>;
}

const isHttp404 = (error: unknown) => /(?:HTTP 404|404 Not Found)/i.test(String(error));

async function save(file: string, state: Checkpoint) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
  await rename(temporary, file);
  await chmod(file, 0o600);
}

async function findRun(runGh: Gh, repository: string, workflowPath: string, ref: string, attemptId: string) {
  const matches: Record<string, unknown>[] = [];
  let complete = false;
  for (let page = 1; page <= 10; page++) {
    const response = object(await runGh(['api', `repos/${repository}/actions/workflows/${encodeURIComponent(workflowPath.split('/').at(-1)!)}/runs?event=workflow_dispatch&branch=${encodeURIComponent(ref)}&per_page=100&page=${page}`, '-H', 'X-GitHub-Api-Version:2026-03-10']));
    if (!Array.isArray(response.workflow_runs)) throw new Error('github_pairing_invalid_response');
    for (const item of response.workflow_runs) {
      const run = object(item);
      if (run.display_title === `Inheriti pairing ${attemptId}` && run.event === 'workflow_dispatch' && run.head_branch === ref)
        matches.push(run);
    }
    if (response.workflow_runs.length < 100) { complete = true; break; }
  }
  const [match] = matches;
  if (!complete || matches.length !== 1 || !match || !Number.isSafeInteger(match.id)) return undefined;
  return match.id as number;
}

export async function pairGithubWorkflow(options: PairOptions): Promise<{ status: 'VERIFIED'; pairingId: string; runId?: number }> {
  if (options.prepare && !/^[0-9a-f]{64}$/i.test(options.workflowDigest ?? '')) throw new Error('github_pairing_workflow_digest_required');
  const { apiUrl, organizationId, connectionId, repository, workflowPath, ref, runGh, operations } = options;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const directory = options.stateDirectory ?? process.env.INHERITI_ELEMENTS_STATE_DIR ?? join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'inheriti');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const scope = createHash('sha256').update(JSON.stringify([apiUrl, organizationId, connectionId, repository, workflowPath, ref])).digest('hex');
  const file = join(directory, `github-pairing-${scope}.json`);
  const lock = `${file}.lock`;
  let handle;
  try { handle = await open(lock, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const owner = Number((await readFile(lock, 'utf8').catch(() => '')).trim());
    if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error('github_pairing_in_progress');
    if (owner > 0) {
      try { process.kill(owner, 0); throw new Error('github_pairing_in_progress'); }
      catch (check) { if ((check as NodeJS.ErrnoException).code !== 'ESRCH') throw check; }
    }
    await rm(lock, { force: true });
    try { handle = await open(lock, 'wx', 0o600); } catch { throw new Error('github_pairing_in_progress'); }
  }
  try {
    await handle.writeFile(String(process.pid));
    let state: Checkpoint | undefined;
    try { state = object(JSON.parse(await readFile(file, 'utf8'))) as unknown as Checkpoint; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('github_pairing_invalid_checkpoint'); }
    if ((await operations.getConnection(connectionId)).status === 'VERIFIED') {
      options.onProgress?.('preparing');
      await options.prepare?.();
      const runId = state?.runId;
      if (typeof runId === 'number' && Number.isSafeInteger(runId) && runId > 0) options.onRun?.(runId);
      options.onProgress?.('verified');
      return { status: 'VERIFIED', pairingId: state?.pairingId ?? '', ...(state?.runId ? { runId: state.runId } : {}) };
    }
    if (state?.phase === 'failed' || state?.phase === 'started' && !!state.expiresAt && Date.parse(state.expiresAt) <= now()) {
      if (!options.retry) throw new Error('github_pairing_failed_retry_required');
      state = undefined;
    }
    if (state && state.workflowDigest !== options.workflowDigest) throw new Error('github_pairing_workflow_changed');
    if (!state) {
      state = { pairingId: randomUUID(), attemptId: randomUUID(), phase: 'prepared',
        ...(options.workflowDigest ? { workflowDigest: options.workflowDigest } : {}) };
      await save(file, state);
    }
    options.onProgress?.('preparing');
    await options.prepare?.();
    if (state.phase === 'prepared' || state.phase === 'started') {
      options.onProgress?.('registering');
      const workflow = `repos/${repository}/actions/workflows/${encodeURIComponent(workflowPath.split('/').at(-1)!)}`;
      let registered = false;
      for (let attempt = 0; attempt <= 15; attempt++) {
        try {
          await runGh(['api', workflow, '-H', 'X-GitHub-Api-Version:2026-03-10']);
          registered = true;
          break;
        } catch (error) {
          if (!isHttp404(error)) throw error;
          if (attempt < 15) await wait(2000);
        }
      }
      if (!registered) throw new Error('github_pairing_workflow_not_registered: Workflow saved, but GitHub has not registered it yet. Rerun the same command; no YAML edits are needed.');
    }
    if (state.phase === 'prepared') {
      options.onProgress?.('pairing');
      const pairing = await operations.startPairing(connectionId, state.pairingId);
      state = { ...state, phase: 'started', expiresAt: pairing.expiresAt };
      await save(file, state);
    }
    if (state.phase === 'started') {
      options.onProgress?.('queued');
      state.phase = 'unknown';
      await save(file, state);
      let result: unknown;
      try {
        result = await runGh(['api', `repos/${repository}/actions/workflows/${encodeURIComponent(workflowPath.split('/').at(-1)!)}/dispatches`, '--method', 'POST', '--input', '-', '-H', 'X-GitHub-Api-Version:2026-03-10'],
          { ref, inputs: { pair_inheriti: true, pairing_attempt: state.attemptId } });
      } catch (error) {
        if (!isHttp404(error)) throw error;
        state.phase = 'started';
        await save(file, state);
        throw new Error('github_pairing_workflow_not_registered: Workflow saved, but GitHub has not registered it yet. Rerun the same command; no YAML edits are needed.');
      }
      if (result && Number.isSafeInteger(object(result).workflow_run_id)) {
        state = { ...state, phase: 'running', runId: object(result).workflow_run_id as number };
        await save(file, state);
      }
    }
    if (state.phase === 'unknown') {
      const runId = await findRun(runGh, repository, workflowPath, ref, state.attemptId);
      if (!runId) throw new Error('github_pairing_unknown_dispatch');
      state = { ...state, phase: 'running', runId };
      await save(file, state);
    }
    if (typeof state.runId === 'number' && Number.isSafeInteger(state.runId) && state.runId > 0) options.onRun?.(state.runId);
    options.onProgress?.('verifying');
    for (let attempt = 0; attempt < (options.pollAttempts ?? 30); attempt++) {
      if ((await operations.getConnection(connectionId)).status === 'VERIFIED') {
        options.onProgress?.('verified');
        return { status: 'VERIFIED', pairingId: state.pairingId, ...(state.runId ? { runId: state.runId } : {}) };
      }
      const run = object(await runGh(['api', `repos/${repository}/actions/runs/${state.runId}`, '-H', 'X-GitHub-Api-Version:2026-03-10']));
      if (run.status === 'in_progress') options.onProgress?.('running');
      if (run.status === 'queued' || run.status === 'pending') options.onProgress?.('queued');
      if (run.status === 'completed' && run.conclusion === 'success') options.onProgress?.('verifying');
      if (run.status === 'completed' && run.conclusion !== 'success') {
        state.phase = 'failed';
        await save(file, state);
        throw new Error('github_pairing_failed_retry_required');
      }
      if (run.status === 'completed' && state.expiresAt && Date.parse(state.expiresAt) <= now()) {
        state.phase = 'failed';
        await save(file, state);
        throw new Error('github_pairing_failed_retry_required');
      }
      if (attempt < (options.pollAttempts ?? 30) - 1) await wait(2000);
    }
    throw new Error('github_pairing_pending');
  } finally { await handle.close(); await rm(lock, { force: true }); }
}
