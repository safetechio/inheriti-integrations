import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { getLocalAssistantInstallStatus, installLocalAssistant, localAssistantPaths } from '../src/local-assistant-install.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); vi.unstubAllGlobals(); });

it('rejects fake and partial artifacts without downloading', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inheriti-assistant-'));
  roots.push(root);
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const paths = localAssistantPaths(root);
  expect((await getLocalAssistantInstallStatus(root)).installed).toBe(false);
  await mkdir(join(root, 'current', 'runtime'), { recursive: true });
  await writeFile(paths.executablePath, 'fixture');
  expect((await getLocalAssistantInstallStatus(root)).installed).toBe(false);
  await writeFile(paths.modelPath, 'fixture');
  await writeFile(join(root, 'current', 'complete.json'), JSON.stringify({ modelHash: 'b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897', executableHash: 'fake' }));
  expect((await getLocalAssistantInstallStatus(root)).installed).toBe(false);
  await expect(installLocalAssistant({ root })).rejects.toThrow('incomplete or corrupt');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('reports downloaded bytes before rejecting an invalid artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inheriti-assistant-'));
  roots.push(root);
  const progress: Array<{ phase: string; downloadedBytes?: number; totalBytes?: number }> = [];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('invalid', { headers: { 'content-length': '7' } })));
  await expect(installLocalAssistant({ root, onProgress: value => progress.push(value) })).rejects.toThrow('checksum mismatch');
  expect(progress).toContainEqual({ phase: 'runtime', downloadedBytes: 7, totalBytes: 7 });
});
