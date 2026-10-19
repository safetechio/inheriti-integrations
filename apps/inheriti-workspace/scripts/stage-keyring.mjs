import { createRequire } from 'node:module';
import { cp, mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const suffix = process.platform === 'linux'
  ? `linux-${process.arch}-gnu`
  : process.platform === 'darwin'
    ? `darwin-${process.arch}`
    : process.platform === 'win32'
      ? `win32-${process.arch}-msvc`
      : undefined;
if (!suffix) throw new Error('Workspace keychain is unsupported on this platform');

const entry = require.resolve('@napi-rs/keyring');
const binding = require.resolve(`@napi-rs/keyring-${suffix}`, { paths: [dirname(entry)] });
const target = join(import.meta.dirname, '..', 'dist', 'node_modules', '@napi-rs', 'keyring');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(entry, join(target, 'index.js'));
await cp(join(dirname(entry), 'package.json'), join(target, 'package.json'));
await cp(join(dirname(entry), 'LICENSE'), join(target, 'LICENSE'));
await cp(binding, join(target, basename(binding)));
