import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadAsset } from '../src/download.js';
import { ActiveRevealRegistry } from '../src/reveal.js';
import type { DownloadUi } from '../src/download.js';

function fixture(path?: string) {
  const exportAsset = vi.fn(async (_selector, destination) => destination({ bytes: new Uint8Array([0, 255, 1]) }));
  const core = {
    getPlan: vi.fn().mockResolvedValue({ governance: { mode: 'DIRECT' }, assets: [
      { id: 'file-id', code: 'runbook', name: 'Runbook', fileName: 'runbook.pdf', isBinary: true },
      { id: 'text-id', code: 'note', name: 'Note', isBinary: false },
    ] }),
    withReveal: vi.fn(async (_id, _options, work) => work({ exportAsset })),
  };
  const ui = {
    withProgress: (async (task) => task({ report: vi.fn() }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: vi.fn() }) })) as DownloadUi['withProgress'],
    pickAsset: vi.fn().mockResolvedValue('runbook'),
    savePath: vi.fn().mockResolvedValue(path),
  };
  return { core, ui, exportAsset };
}

describe('VS Code binary download', () => {
  it('selects only binary assets and saves exact bytes without editor insertion', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'inheriti-ide-download-')), 'runbook.pdf');
    const { core, ui, exportAsset } = fixture(path);
    await expect(downloadAsset(core as never, ui as never, new ActiveRevealRegistry(), 'plan-1')).resolves.toBe(true);
    expect(ui.pickAsset).toHaveBeenCalledWith([{ label: 'Runbook', description: 'runbook', selector: 'runbook', fileName: 'runbook.pdf' }]);
    expect(ui.savePath).toHaveBeenCalledWith('runbook.pdf');
    expect(exportAsset).toHaveBeenCalledWith('runbook', expect.any(Function));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect([...await readFile(path)]).toEqual([0, 255, 1]);
  });

  it('refuses overwrite and aborts when save is canceled', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'inheriti-ide-download-')), 'existing.pdf');
    await writeFile(path, 'old');
    const first = fixture(path);
    await expect(downloadAsset(first.core as never, first.ui as never, new ActiveRevealRegistry(), 'plan-1')).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(path, 'utf8')).toBe('old');
    const second = fixture();
    await expect(downloadAsset(second.core as never, second.ui as never, new ActiveRevealRegistry(), 'plan-1')).rejects.toMatchObject({ name: 'AbortError' });
    expect(second.exportAsset).not.toHaveBeenCalled();
  });
});
