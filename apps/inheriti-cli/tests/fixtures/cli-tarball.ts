import { gzipSync } from 'node:zlib';

function entry(name: string, text: string): Buffer {
  const data = Buffer.from(text);
  const head = Buffer.alloc(512);
  head.write(name, 0);
  head.write('0000644\0', 100);
  head.write('0000000\0', 108);
  head.write('0000000\0', 116);
  head.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
  head.write('00000000000\0', 136);
  head.write('        ', 148);
  head.write('0', 156);
  head.write('ustar\0', 257);
  head.write('00', 263);
  const sum = head.reduce((n, byte) => n + byte, 0);
  head.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([head, data, Buffer.alloc((512 - data.length % 512) % 512)]);
}
export function cliTarball(version: string, options: { name?: string; bin?: Record<string, string>; deployment?: string; extraEntries?: Array<[string, string]> } = {}): Buffer {
  return gzipSync(Buffer.concat([
    entry('package/package.json', JSON.stringify({
      name: options.name ?? '@safetech/inheriti-cli', version, bin: options.bin ?? { inheriti: 'dist/main.js' },
    })),
    entry('package/dist/build-deployment.json', JSON.stringify({ deployment: options.deployment ?? version.split('-')[1]?.split('.')[0] })),
    entry('package/dist/main.js', '#!/usr/bin/env node\n'),
    ...(options.extraEntries ?? []).map(([path, data]) => entry(path, data)),
    Buffer.alloc(1024),
  ]));
}
