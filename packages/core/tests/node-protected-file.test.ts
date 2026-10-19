import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveProtectedFile } from '../src/node-protected-file.js';

const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });

it('durably saves sealed bytes to a new owner-only .inheriti file', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'protected-save-'));
  folders.push(folder);
  const path = join(folder, 'asset.inheriti');
  const bytes = Uint8Array.from([1, 2, 3]);
  await saveProtectedFile(path, bytes);
  expect(new Uint8Array(await readFile(path))).toEqual(bytes);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  await expect(saveProtectedFile(path, bytes)).rejects.toMatchObject({ code: 'EEXIST' });
  expect(new Uint8Array(await readFile(path))).toEqual(bytes);
});

it('rejects another extension and cancellation before creating a file', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'protected-save-'));
  folders.push(folder);
  const path = join(folder, 'asset.inheriti');
  await expect(saveProtectedFile(join(folder, 'asset.txt'), Uint8Array.of(1))).rejects.toThrow('viewer_file_invalid');
  const controller = new AbortController();
  controller.abort();
  await expect(saveProtectedFile(path, Uint8Array.of(1), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  await writeFile(path, 'existing');
  await expect(saveProtectedFile(path, Uint8Array.of(2))).rejects.toMatchObject({ code: 'EEXIST' });
  expect(await readFile(path, 'utf8')).toBe('existing');
});
