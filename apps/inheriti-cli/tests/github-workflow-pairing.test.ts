import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pairGithubWorkflow } from '../src/commands/github-workflow-pairing.js';

const base = { apiUrl: 'https://business.example/api', organizationId: 'org', connectionId: 'connection',
  repository: 'team/app', workflowPath: '.github/workflows/inheriti.yml', ref: 'main' };

async function fixture() {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'github-pairing-'));
  let verified = false;
  const operations = { startPairing: vi.fn(async (_id: string, _pairingId?: string) => ({ expiresAt: '2099-01-01T00:00:00Z' })),
    getConnection: vi.fn(async () => ({ status: verified ? 'VERIFIED' : 'PENDING_VERIFICATION' })) };
  const cleanup = () => rm(stateDirectory, { recursive: true, force: true });
  const options = { ...base, stateDirectory, operations, now: () => 0, pollAttempts: 1 };
  return { options, operations, cleanup, verify: () => { verified = true; } };
}

describe('GitHub workflow pairing checkpoint', () => {
  it('reports pending verification without reporting success', async () => {
    const f = await fixture();
    const onProgress = vi.fn();
    try {
      const runGh = vi.fn(async (args: string[]) => args.includes('POST') ? { workflow_run_id: 42 } : { status: 'queued' });
      await expect(pairGithubWorkflow({ ...f.options, runGh, onProgress })).rejects.toThrow('github_pairing_pending');
      expect(onProgress.mock.calls.map(call => call[0])).toContain('verifying');
      expect(onProgress.mock.calls.map(call => call[0])).not.toContain('verified');
      f.verify();
      await expect(pairGithubWorkflow({ ...f.options, runGh, onProgress })).resolves.toMatchObject({ status: 'VERIFIED' });
      expect(onProgress.mock.calls.map(call => call[0])).toContain('verified');
    } finally { await f.cleanup(); }
  });
  it('resumes a queued run with the same pairing and dispatch IDs', async () => {
    const f = await fixture();
    try {
      const runGh = vi.fn(async (args: string[], _body?: unknown) => args.includes('POST')
        ? { workflow_run_id: 42 } : { status: 'queued' });
      await expect(pairGithubWorkflow({ ...f.options, runGh })).rejects.toThrow('github_pairing_pending');
      await expect(pairGithubWorkflow({ ...f.options, runGh, retry: true })).rejects.toThrow('github_pairing_pending');
      expect(f.operations.startPairing).toHaveBeenCalledTimes(1);
      expect(runGh.mock.calls.filter(call => call[0].includes('POST'))).toHaveLength(1);
      const checkpoint = JSON.parse(await readFile(join(f.options.stateDirectory, (await readdir(f.options.stateDirectory)).find(name => name.endsWith('.json'))!), 'utf8'));
      expect((await stat(f.options.stateDirectory)).mode & 0o777).toBe(0o700);
      expect((await stat(join(f.options.stateDirectory, (await readdir(f.options.stateDirectory)).find(name => name.endsWith('.json'))!))).mode & 0o777).toBe(0o600);
      expect(checkpoint.runId).toBe(42);
      expect((runGh.mock.calls.find(call => call[0].includes('POST'))?.[1] as any).inputs.pairing_attempt).toBe(checkpoint.attemptId);
      f.verify();
      await expect(pairGithubWorkflow({ ...f.options, runGh })).resolves.toMatchObject({ status: 'VERIFIED', runId: 42, pairingId: checkpoint.pairingId });
    } finally { await f.cleanup(); }
  });

  it('reconciles a lost dispatch response by exact run title without dispatching again', async () => {
    const f = await fixture();
    try {
      let attempt = '';
      const runGh = vi.fn(async (args: string[], body?: unknown) => {
        if (args.includes('POST')) { attempt = (body as any).inputs.pairing_attempt; throw new Error('response lost'); }
        if (args[1]?.includes('/runs?')) return { workflow_runs: [{ id: 73, display_title: `Inheriti pairing ${attempt}`, event: 'workflow_dispatch', head_branch: 'main' }] };
        return { status: 'queued' };
      });
      await expect(pairGithubWorkflow({ ...f.options, runGh })).rejects.toThrow('response lost');
      await expect(pairGithubWorkflow({ ...f.options, runGh })).rejects.toThrow('github_pairing_pending');
      expect(runGh.mock.calls.filter(call => call[0].includes('POST'))).toHaveLength(1);
      expect(runGh.mock.calls.some(call => call[0][1]?.includes('/actions/runs/73'))).toBe(true);
    } finally { await f.cleanup(); }
  });

  it('keeps an unknown dispatch pending even when retry is requested', async () => {
    const f = await fixture();
    try {
      const runGh = vi.fn(async (args: string[]) => args.includes('POST') ? undefined : { workflow_runs: [] });
      const prepare = vi.fn(async () => {});
      const workflowDigest = 'a'.repeat(64);
      await expect(pairGithubWorkflow({ ...f.options, runGh, workflowDigest, prepare })).rejects.toThrow('github_pairing_unknown_dispatch');
      await expect(pairGithubWorkflow({ ...f.options, runGh, workflowDigest, prepare, retry: true })).rejects.toThrow('github_pairing_unknown_dispatch');
      await expect(pairGithubWorkflow({ ...f.options, runGh, workflowDigest: 'b'.repeat(64), prepare, retry: true }))
        .rejects.toThrow('github_pairing_workflow_changed');
      expect(prepare).toHaveBeenCalledTimes(2);
      expect(runGh.mock.calls.filter(call => call[0].includes('POST'))).toHaveLength(1);
    } finally { await f.cleanup(); }
  });

  it('reuses the same pairing ID after a lost start response', async () => {
    const f = await fixture();
    try {
      f.operations.startPairing.mockRejectedValueOnce(new Error('response lost'));
      const runGh = vi.fn(async (args: string[]) => args.includes('POST') ? { workflow_run_id: 1 } : { status: 'queued' });
      await expect(pairGithubWorkflow({ ...f.options, runGh })).rejects.toThrow('response lost');
      await expect(pairGithubWorkflow({ ...f.options, runGh })).rejects.toThrow('github_pairing_pending');
      expect(f.operations.startPairing).toHaveBeenCalledTimes(2);
      expect(f.operations.startPairing.mock.calls[0]?.[1]).toBe(f.operations.startPairing.mock.calls[1]?.[1]);
    } finally { await f.cleanup(); }
  });

  it('requires explicit retry after terminal failure and guards concurrent processes', async () => {
    const f = await fixture();
    try {
      const runGh = vi.fn(async (args: string[]) => args.includes('POST') ? { workflow_run_id: 5 } : { status: 'completed', conclusion: 'failure' });
      await expect(pairGithubWorkflow({ ...f.options, runGh })).rejects.toThrow('github_pairing_failed_retry_required');
      await expect(pairGithubWorkflow({ ...f.options, runGh })).rejects.toThrow('github_pairing_failed_retry_required');
      expect(runGh.mock.calls.filter(call => call[0].includes('POST'))).toHaveLength(1);
      const lock = join(f.options.stateDirectory, (await readdir(f.options.stateDirectory)).find(name => name.endsWith('.json'))! + '.lock');
      await writeFile(lock, String(process.pid));
      await expect(pairGithubWorkflow({ ...f.options, runGh, retry: true })).rejects.toThrow('github_pairing_in_progress');
      await rm(lock);
      await expect(pairGithubWorkflow({ ...f.options, runGh, retry: true })).rejects.toThrow('github_pairing_failed_retry_required');
      expect(f.operations.startPairing).toHaveBeenCalledTimes(2);
    } finally { await f.cleanup(); }
  });

  it('recovers an abandoned lock without repeating the dispatch', async () => {
    const f = await fixture();
    try {
      const runGh = vi.fn(async (args: string[]) => args.includes('POST') ? { workflow_run_id: 9 } : { status: 'queued' });
      await expect(pairGithubWorkflow({ ...f.options, runGh })).rejects.toThrow('github_pairing_pending');
      const lock = join(f.options.stateDirectory, (await readdir(f.options.stateDirectory)).find(name => name.endsWith('.json'))! + '.lock');
      await writeFile(lock, '999999999');
      await expect(pairGithubWorkflow({ ...f.options, runGh })).rejects.toThrow('github_pairing_pending');
      expect(runGh.mock.calls.filter(call => call[0].includes('POST'))).toHaveLength(1);
    } finally { await f.cleanup(); }
  });

  it.each(['', '  ', 'not-a-pid', '-1', '1.5'])('keeps an invalid lock owner %j fail closed', async owner => {
    const f = await fixture();
    try {
      const scope = createHash('sha256').update(JSON.stringify([base.apiUrl, base.organizationId, base.connectionId,
        base.repository, base.workflowPath, base.ref])).digest('hex');
      const lock = join(f.options.stateDirectory, `github-pairing-${scope}.json.lock`);
      await writeFile(lock, owner);
      const prepare = vi.fn(async () => {});
      const runGh = vi.fn(async () => ({ workflow_run_id: 1 }));
      await expect(pairGithubWorkflow({ ...f.options, runGh, workflowDigest: 'a'.repeat(64), prepare }))
        .rejects.toThrow('github_pairing_in_progress');
      expect(prepare).not.toHaveBeenCalled();
      expect(f.operations.startPairing).not.toHaveBeenCalled();
      expect(runGh).not.toHaveBeenCalled();
      expect(await readFile(lock, 'utf8')).toBe(owner);
    } finally { await f.cleanup(); }
  });

  it('guards DEV artifact preparation by the pending workflow digest and same scope lock', async () => {
    const f = await fixture();
    try {
      const prepare = vi.fn(async () => {});
      const runGh = vi.fn(async (args: string[]) => args.includes('POST') ? { workflow_run_id: 12 } : { status: 'queued' });
      const workflowDigest = 'a'.repeat(64);
      await expect(pairGithubWorkflow({ ...f.options, runGh, workflowDigest, prepare })).rejects.toThrow('github_pairing_pending');
      expect(prepare).toHaveBeenCalledTimes(1);
      await expect(pairGithubWorkflow({ ...f.options, runGh, workflowDigest: 'b'.repeat(64), prepare, retry: true }))
        .rejects.toThrow('github_pairing_workflow_changed');
      expect(prepare).toHaveBeenCalledTimes(1);
      await expect(pairGithubWorkflow({ ...f.options, runGh, workflowDigest, prepare })).rejects.toThrow('github_pairing_pending');
      expect(prepare).toHaveBeenCalledTimes(2);
      expect(runGh.mock.calls.filter(call => call[0].includes('POST'))).toHaveLength(1);
      const lock = join(f.options.stateDirectory, (await readdir(f.options.stateDirectory)).find(name => name.endsWith('.json'))! + '.lock');
      await writeFile(lock, String(process.pid));
      await expect(pairGithubWorkflow({ ...f.options, runGh, workflowDigest, prepare })).rejects.toThrow('github_pairing_in_progress');
      expect(prepare).toHaveBeenCalledTimes(2);
    } finally { await f.cleanup(); }
  });

  it('persists the workflow digest before preparation and lets a verified connection refresh it', async () => {
    const f = await fixture();
    try {
      const prepare = vi.fn().mockRejectedValueOnce(new Error('upload failed')).mockResolvedValue(undefined);
      const runGh = vi.fn(async () => ({ workflow_run_id: 13 }));
      const workflowDigest = 'a'.repeat(64);
      await expect(pairGithubWorkflow({ ...f.options, runGh, workflowDigest, prepare })).rejects.toThrow('upload failed');
      const checkpoint = JSON.parse(await readFile(join(f.options.stateDirectory, (await readdir(f.options.stateDirectory)).find(name => name.endsWith('.json'))!), 'utf8'));
      expect(checkpoint.workflowDigest).toBe(workflowDigest);
      expect(checkpoint.phase).toBe('prepared');
      expect(f.operations.startPairing).not.toHaveBeenCalled();
      f.verify();
      await expect(pairGithubWorkflow({ ...f.options, runGh, workflowDigest: 'b'.repeat(64), prepare })).resolves.toMatchObject({ status: 'VERIFIED' });
      expect(prepare).toHaveBeenCalledTimes(2);
      expect(runGh).not.toHaveBeenCalled();
    } finally { await f.cleanup(); }
  });

  it('waits for workflow registration before opening the pairing window', async () => {
    const f = await fixture();
    try {
      let registered = false;
      const wait = vi.fn(async () => {});
      const prepare = vi.fn(async () => {});
      const runGh = vi.fn(async (args: string[]) => {
        if (args[1]?.includes('/actions/workflows/') && !args.includes('POST') && !registered)
          throw new Error('gh: Not Found (HTTP 404)');
        return args.includes('POST') ? { workflow_run_id: 21 } : { status: 'queued' };
      });
      await expect(pairGithubWorkflow({ ...f.options, runGh, wait, prepare, workflowDigest: 'a'.repeat(64) }))
        .rejects.toThrow('Workflow saved, but GitHub has not registered it yet');
      expect(wait).toHaveBeenCalledTimes(15);
      expect(f.operations.startPairing).not.toHaveBeenCalled();
      expect(runGh.mock.calls.some(call => call[0].includes('POST'))).toBe(false);
      registered = true;
      await expect(pairGithubWorkflow({ ...f.options, runGh, wait, prepare, workflowDigest: 'a'.repeat(64) }))
        .rejects.toThrow('github_pairing_pending');
      expect(f.operations.startPairing).toHaveBeenCalledTimes(1);
      expect(runGh.mock.calls.filter(call => call[0].includes('POST'))).toHaveLength(1);
    } finally { await f.cleanup(); }
  });

  it('restores started state after a confirmed dispatch 404 and retries the same pairing', async () => {
    const f = await fixture();
    try {
      let dispatches = 0;
      const runGh = vi.fn(async (args: string[]) => {
        if (args.includes('POST') && ++dispatches === 1) throw new Error('gh: Not Found (HTTP 404)');
        return args.includes('POST') ? { workflow_run_id: 22 } : { status: 'queued' };
      });
      await expect(pairGithubWorkflow({ ...f.options, runGh })).rejects.toThrow('Workflow saved, but GitHub has not registered it yet');
      const checkpoint = JSON.parse(await readFile(join(f.options.stateDirectory, (await readdir(f.options.stateDirectory)).find(name => name.endsWith('.json'))!), 'utf8'));
      expect(checkpoint.phase).toBe('started');
      await expect(pairGithubWorkflow({ ...f.options, runGh })).rejects.toThrow('github_pairing_pending');
      expect(f.operations.startPairing).toHaveBeenCalledTimes(1);
      expect(dispatches).toBe(2);
      expect(runGh.mock.calls.some(call => call[0][1]?.includes('/runs?'))).toBe(false);
    } finally { await f.cleanup(); }
  });
});
