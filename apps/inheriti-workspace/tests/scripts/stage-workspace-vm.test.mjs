import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { stageWorkspaceVm } from '../../scripts/stage-workspace-vm.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'workspace-vm-test-'));
  const source = join(root, 'source');
  const output = join(root, 'output');
  mkdirSync(join(source, 'LICENSES'), { recursive: true });
  writeFileSync(join(source, 'qemu-system-x86_64'), 'qemu', { mode: 0o755 });
  writeFileSync(join(source, 'vmlinuz'), 'kernel');
  writeFileSync(join(source, 'initramfs'), 'guest');
  writeFileSync(join(source, 'LICENSES', 'QEMU.txt'), 'license');
  const files = {
    'qemu-system-x86_64': digest('qemu'),
    vmlinuz: digest('kernel'),
    initramfs: digest('guest'),
    'LICENSES/QEMU.txt': digest('license'),
  };
  const manifest = JSON.stringify({ schema: 1, files });
  writeFileSync(join(source, 'manifest.sha256.json'), manifest);
  return { root, source, output, pin: digest(manifest) };
}

function addVirglResource(source, family, id, includeVirgl) {
  const files = JSON.parse(readFileSync(join(source, 'manifest.sha256.json'), 'utf8')).files;
  const adapter = `adapters/${family}/${id}/x86_64/manifest`;
  mkdirSync(join(source, 'adapters', family, id, 'x86_64'), { recursive: true });
  writeFileSync(join(source, adapter), 'signed adapter metadata');
  files[adapter] = digest('signed adapter metadata');
  if (includeVirgl) {
    writeFileSync(join(source, 'initramfs-virgl'), 'virgl guest');
    files['initramfs-virgl'] = digest('virgl guest');
  }
  const manifest = JSON.stringify({ schema: 1, files });
  writeFileSync(join(source, 'manifest.sha256.json'), manifest);
  return digest(manifest);
}

test('stages a validated VM bundle', () => {
  const { root, source, output, pin } = fixture();
  try {
    stageWorkspaceVm(source, 'linux', 'x64', output, pin);
    assert.equal(readFileSync(join(output, 'vmlinuz'), 'utf8'), 'kernel');
    assert.equal(readFileSync(join(output, 'LICENSES', 'QEMU.txt'), 'utf8'), 'license');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('GridCraft requires its separate VirGL guest image', () => {
  const { root, source, output } = fixture();
  try {
    const pin = addVirglResource(source, 'spreadsheet', 'gridcraft', false);
    assert.throws(() => stageWorkspaceVm(source, 'linux', 'x64', output, pin), /initramfs-virgl/);
    const completePin = addVirglResource(source, 'spreadsheet', 'gridcraft', true);
    stageWorkspaceVm(source, 'linux', 'x64', output, completePin);
    assert.equal(readFileSync(join(output, 'initramfs-virgl'), 'utf8'), 'virgl guest');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('WordCraft requires its separate VirGL guest image', () => {
  const { root, source, output } = fixture();
  try {
    const pin = addVirglResource(source, 'document', 'wordcraft', false);
    assert.throws(() => stageWorkspaceVm(source, 'linux', 'x64', output, pin), /initramfs-virgl/);
    const completePin = addVirglResource(source, 'document', 'wordcraft', true);
    stageWorkspaceVm(source, 'linux', 'x64', output, completePin);
    assert.equal(readFileSync(join(output, 'initramfs-virgl'), 'utf8'), 'virgl guest');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rejects a missing license and preserves previously staged output', () => {
  const { root, source, output, pin } = fixture();
  try {
    mkdirSync(output);
    writeFileSync(join(output, 'marker'), 'existing');
    rmSync(join(source, 'LICENSES'), { recursive: true });
    assert.throws(() => stageWorkspaceVm(source, 'linux', 'x64', output, pin), /LICENSES/);
    assert.equal(readFileSync(join(output, 'marker'), 'utf8'), 'existing');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rejects links in the bundle', () => {
  const { root, source, output, pin } = fixture();
  try {
    // A Windows directory junction works without Developer Mode; both forms
    // must be rejected as links by the staging inventory.
    symlinkSync(join(source, 'LICENSES'), join(source, 'linked-licenses'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => stageWorkspaceVm(source, 'linux', 'x64', output, pin), /contains a link/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('requires the host-specific QEMU executable', () => {
  const { root, source, output, pin } = fixture();
  try {
    assert.throws(() => stageWorkspaceVm(source, 'win32', 'x64', output, pin), /qemu-system-x86_64.exe/);
    assert.throws(() => stageWorkspaceVm(source, 'darwin', 'arm64', output, pin), /qemu-system-aarch64/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rejects an unpinned or changed manifest', () => {
  const { root, source, output, pin } = fixture();
  try {
    assert.throws(() => stageWorkspaceVm(source, 'linux', 'x64', output), /pinned SHA-256/);
    writeFileSync(join(source, 'manifest.sha256.json'), '{}');
    assert.throws(() => stageWorkspaceVm(source, 'linux', 'x64', output, pin), /manifest SHA-256 mismatch/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rejects tampered and unlisted files', () => {
  const { root, source, output, pin } = fixture();
  try {
    writeFileSync(join(source, 'vmlinuz'), 'changed');
    assert.throws(() => stageWorkspaceVm(source, 'linux', 'x64', output, pin), /SHA-256 mismatch: vmlinuz/);
    writeFileSync(join(source, 'vmlinuz'), 'kernel');
    writeFileSync(join(source, 'unlisted'), 'extra');
    assert.throws(() => stageWorkspaceVm(source, 'linux', 'x64', output, pin), /file inventory mismatch/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
