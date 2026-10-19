import { open, unlink } from 'node:fs/promises';
import { extname } from 'node:path';

export async function saveProtectedFile(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
  if (extname(path).toLowerCase() !== '.inheriti') throw new Error('viewer_file_invalid');
  signal?.throwIfAborted();
  const file = await open(path, 'wx', 0o600);
  let saved = false;
  try {
    await file.writeFile(bytes);
    signal?.throwIfAborted();
    await file.sync();
    signal?.throwIfAborted();
    await file.close();
    saved = true;
  } finally {
    if (!saved) {
      await file.close().catch(() => undefined);
      await unlink(path).catch(() => undefined);
    }
  }
}
