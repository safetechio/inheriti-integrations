import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const manifestName = 'manifest.sha256.json';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function inventory(root, path = root, files = []) {
  for (const name of readdirSync(path)) {
    const child = join(path, name);
    const info = lstatSync(child);
    if (info.isDirectory()) inventory(root, child, files);
    else if (info.isFile()) files.push(relative(root, child).replaceAll('\\', '/'));
    else throw new Error(`Invalid Workspace VM component: ${child}`);
  }
  return files.sort();
}

function inputManifest(vm, pin) {
  if (!/^[a-f0-9]{64}$/i.test(pin ?? '')) throw new Error('Pinned Workspace VM manifest SHA-256 is required');
  const original = readFileSync(join(vm, manifestName));
  if (hash(original) !== pin.toLowerCase()) throw new Error('Pinned Workspace VM manifest SHA-256 mismatch');
  const manifest = JSON.parse(original.toString('utf8'));
  if (manifest?.schema !== 1 || !manifest.files || Array.isArray(manifest.files) || typeof manifest.files !== 'object') {
    throw new Error('Invalid Workspace VM manifest schema');
  }
  const actual = inventory(vm).filter((name) => name !== manifestName);
  const expected = Object.keys(manifest.files).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Workspace VM file inventory mismatch');
  return { original, manifest, expected };
}

export function verifySignedVm(vm, pin) {
  const { manifest, expected } = inputManifest(vm, pin);
  for (const name of expected) {
    const expectedHash = manifest.files[name];
    if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedHash) || hash(readFileSync(join(vm, name))) !== expectedHash.toLowerCase()) {
      throw new Error(`Workspace VM SHA-256 mismatch: ${name}`);
    }
  }
}

export function sealSignedVm(vm, pin, evidence) {
  const { original, manifest, expected } = inputManifest(vm, pin);
  if (resolve(dirname(evidence)) === resolve(vm) || resolve(evidence).startsWith(`${resolve(vm)}/`)) {
    throw new Error('Pinned input manifest evidence must be outside Workspace VM');
  }
  writeFileSync(evidence, original, { flag: 'wx' });
  for (const name of expected) manifest.files[name] = hash(readFileSync(join(vm, name)));
  const temporary = join(vm, `${manifestName}.tmp-${process.pid}`);
  try {
    writeFileSync(temporary, JSON.stringify(manifest));
    renameSync(temporary, join(vm, manifestName));
    verifySignedVm(vm, hash(readFileSync(join(vm, manifestName))));
    if (hash(readFileSync(evidence)) !== pin.toLowerCase()) throw new Error('Pinned input manifest evidence mismatch');
  } finally {
    rmSync(temporary, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , mode, vm, pin, evidence] = process.argv;
  if (mode === 'verify') verifySignedVm(vm, pin);
  else if (mode === 'seal' && evidence) sealSignedVm(vm, pin, evidence);
  else throw new Error('usage: seal-signed-vm.mjs verify|seal <vm-dir> <pinned-hash> [evidence-path]');
}
