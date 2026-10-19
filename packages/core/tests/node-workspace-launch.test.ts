import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openInheritiFile } from '../src/node-workspace-launch.js';

const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });

describe('Workspace launch file boundary', () => {
  it('rejects non-Inheriti files, empty files and symlinks before launching an OS program', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'viewer-launch-'));
    folders.push(folder);
    const plain = join(folder, 'plain.txt');
    const empty = join(folder, 'empty.inheriti');
    const link = join(folder, 'link.inheriti');
    await writeFile(plain, 'content');
    await writeFile(empty, '');
    await symlink(plain, link);
    await expect(openInheritiFile(plain)).rejects.toThrow('viewer_file_invalid');
    await expect(openInheritiFile(empty)).rejects.toThrow('viewer_file_invalid');
    await expect(openInheritiFile(link)).rejects.toThrow('viewer_file_invalid');
  });
});
