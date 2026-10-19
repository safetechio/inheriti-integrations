/** Read only a bounded, regular .inheriti file without following symlinks.
 * The caller owns the returned bytes and must zero them after use.
 */
import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';

export async function readStartupFile(path: string | undefined, maxBytes: number): Promise<Uint8Array> {
  if (!path?.endsWith('.inheriti')) throw new Error('invalid_startup_file');
  const file = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  let bytes: Uint8Array | undefined;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) throw new Error('file_too_large');
    bytes = new Uint8Array(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error('invalid_startup_file');
      offset += bytesRead;
    }
    if ((await file.read(new Uint8Array(1), 0, 1, bytes.length)).bytesRead) throw new Error('invalid_startup_file');
    return bytes;
  } catch (error) { bytes?.fill(0); throw error; }
  finally { await file.close(); }
}
