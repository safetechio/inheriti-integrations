import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadPlanAsset } from '../src/commands/download.js';
import type { Terminal } from '../src/output.js';

function fixture() {
  const lines: string[] = [];
  const terminal = { lines, interactive: false, columns: 80, write: (line: string) => lines.push(line), writeError: vi.fn() } as Terminal & { lines: string[] };
  const exportAsset = vi.fn(async (_asset: string, destination: (asset: { bytes: Uint8Array }) => Promise<void>) => {
    await destination({ bytes: new Uint8Array([0, 255, 1]) });
  });
  const withReveal = vi.fn(async (_id, _options, work) => work({ exportAsset }));
  const context = { core: { getAccessToken: async () => 'token', getPlan: async () => ({ assets: [], governance: { mode: 'DIRECT' } }), withReveal } } as never;
  return { context, terminal, withReveal, exportAsset };
}

describe('plans download', () => {
  it('saves exact bytes in a new owner-only file and prints metadata only', async () => {
    const output = join(await mkdtemp(join(tmpdir(), 'inheriti-download-')), 'asset.pdf');
    const { context, terminal, withReveal, exportAsset } = fixture();
    await expect(downloadPlanAsset(context, terminal, 'plan-1', 'runbook', output)).resolves.toBe(0);
    expect([...await readFile(output)]).toEqual([0, 255, 1]);
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    expect(exportAsset).toHaveBeenCalledWith('runbook', expect.any(Function));
    expect(withReveal).toHaveBeenCalledWith('plan-1', expect.objectContaining({ mode: 'DIRECT' }), expect.any(Function));
    expect(terminal.lines.join('\n')).not.toContain('255');
  });

  it('never overwrites an existing file', async () => {
    const output = join(await mkdtemp(join(tmpdir(), 'inheriti-download-')), 'existing.pdf');
    await writeFile(output, 'old');
    const { context, terminal } = fixture();
    await expect(downloadPlanAsset(context, terminal, 'plan-1', 'runbook', output)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(output, 'utf8')).toBe('old');
  });

  it('does not create a file when canceled before delivery', async () => {
    const output = join(await mkdtemp(join(tmpdir(), 'inheriti-download-')), 'cancel.pdf');
    const { context, terminal } = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(downloadPlanAsset(context, terminal, 'plan-1', 'runbook', output, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
