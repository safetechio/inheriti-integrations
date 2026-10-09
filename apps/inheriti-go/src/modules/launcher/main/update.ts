import { createHash } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import type { InternalBuild } from '@safetech/inheriti-elements-core/node';

export async function downloadGoUpdate(build: InternalBuild, url: string, destination: string): Promise<void> {
  if (!/^https:\/\//u.test(url) || !Number.isSafeInteger(build.size) || build.size < 1 || !/^[a-f0-9]{64}$/u.test(build.checksum)) {
    throw new Error('Invalid update metadata.');
  }
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error('Update download failed.');
  const file = await open(destination, 'wx', 0o600);
  let complete = false;
  try {
    const hash = createHash('sha256');
    const reader = response.body.getReader();
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > build.size) throw new Error('Update integrity check failed.');
      hash.update(value);
      for (let offset = 0; offset < value.length;) offset += (await file.write(value, offset)).bytesWritten;
    }
    if (size !== build.size || hash.digest('hex') !== build.checksum) throw new Error('Update integrity check failed.');
    if (process.platform === 'linux') await file.chmod(0o700);
    complete = true;
  } finally {
    await file.close();
    if (!complete) await rm(destination, { force: true });
  }
}
