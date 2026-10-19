import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { sealSignedVm, verifySignedVm } from '../../scripts/seal-signed-vm.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'workspace-vm-seal-'));
  const vm = join(root, 'workspace-vm');
  mkdirSync(vm);
  writeFileSync(join(vm, 'qemu-system-x86_64'), 'unsigned', { mode: 0o755 });
  writeFileSync(join(vm, 'vmlinuz'), 'kernel');
  const original = JSON.stringify({ schema: 1, files: {
    'qemu-system-x86_64': digest('unsigned'), vmlinuz: digest('kernel'),
  } });
  writeFileSync(join(vm, 'manifest.sha256.json'), original);
  return { root, vm, original, pin: digest(original), evidence: join(root, 'input-manifest.json') };
}

test('preserves pinned input evidence and seals signed bytes', () => {
  const { root, vm, original, pin, evidence } = fixture();
  try {
    verifySignedVm(vm, pin);
    writeFileSync(join(vm, 'qemu-system-x86_64'), 'signed');
    sealSignedVm(vm, pin, evidence);
    assert.equal(readFileSync(evidence, 'utf8'), original);
    const final = readFileSync(join(vm, 'manifest.sha256.json'));
    assert.equal(JSON.parse(final).files['qemu-system-x86_64'], digest('signed'));
    verifySignedVm(vm, digest(final));
    assert.throws(() => verifySignedVm(vm, pin), /manifest SHA-256 mismatch/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rejects changed input and unlisted VM files', () => {
  const { root, vm, pin, evidence } = fixture();
  try {
    writeFileSync(join(vm, 'vmlinuz'), 'tampered');
    assert.throws(() => verifySignedVm(vm, pin), /SHA-256 mismatch: vmlinuz/);
    writeFileSync(join(vm, 'vmlinuz'), 'kernel');
    writeFileSync(join(vm, 'extra'), 'unlisted');
    assert.throws(() => sealSignedVm(vm, pin, evidence), /file inventory mismatch/);
    rmSync(join(vm, 'extra'));
    assert.throws(() => sealSignedVm(vm, '0'.repeat(64), evidence), /manifest SHA-256 mismatch/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
