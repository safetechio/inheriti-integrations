import { existsSync, fsyncSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const crypto = vi.hoisted(() => ({ available: true, backend: 'gnome_libsecret', path: '' }));
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return { ...original, fsyncSync: vi.fn(original.fsyncSync) };
});
vi.mock('electron', () => ({
  app: { getPath: () => crypto.path },
  safeStorage: {
    isEncryptionAvailable: () => crypto.available,
    getSelectedStorageBackend: () => crypto.backend,
    encryptString: (text: string) => Buffer.from(`encrypted:${text}`),
    decryptString: (value: Buffer) => {
      const text = value.toString();
      if (!text.startsWith('encrypted:')) throw new Error('Invalid ciphertext');
      return text.slice('encrypted:'.length);
    },
  },
}));

import { ProtectedCheckpoint } from '../src/modules/launcher/main/protected-checkpoint.js';

describe('ProtectedCheckpoint', () => {
  afterEach(() => { rmSync(crypto.path, { recursive: true, force: true }); crypto.available = true; crypto.backend = 'gnome_libsecret'; vi.mocked(fsyncSync).mockRestore(); });

  it('removes a temporary file after a failed sync so the next save succeeds', () => {
    crypto.path = mkdtempSync(join(tmpdir(), 'tray-checkpoint-'));
    vi.mocked(fsyncSync).mockImplementationOnce(() => { throw new Error('sync failed'); });
    const storage = new ProtectedCheckpoint();
    expect(() => storage.setItem('secret', 'first')).toThrow('sync failed');
    expect(existsSync(join(crypto.path, `protected-checkpoint.${process.pid}.tmp`))).toBe(false);
    storage.setItem('secret', 'second');
    expect(storage.getItem('secret')).toBe('second');
  });

  it('restores storage and payload after restart without writing plaintext', async () => {
    crypto.path = mkdtempSync(join(tmpdir(), 'tray-checkpoint-'));
    const first = new ProtectedCheckpoint();
    first.setItem('session/key', { secret: 'private-value' });
    first.setItem('plan-edit/attempt', { planId: 'plan-1', editId: 'edit-1' });
    await first.savePayload('plan-1', { secret: 'payload-value' });
    await first.save({ organizationId: 'org-1', planId: 'plan-1', editId: 'edit-1', assetId: 'asset-1', material: { mergeProcessId: 'edit-1', validatorShares: [], dataShards: [], backupShards: [], encryptedKey: 'sealed-material' } });
    const second = new ProtectedCheckpoint();
    expect(second.getItem('session/key')).toEqual({ secret: 'private-value' });
    expect(await second.getPayload('plan-1')).toEqual({ secret: 'payload-value' });
    expect((await second.load('plan-1'))?.material.encryptedKey).toBe('sealed-material');
    expect(readFileSync(join(crypto.path, 'protected-checkpoint'), 'utf8')).not.toContain('private-value');
    await second.remove('plan-1');
    const third = new ProtectedCheckpoint();
    expect(third.getItem('plan-edit/attempt')).toBeNull();
    expect(await third.load('plan-1')).toBeNull();
  });

  it('reads a large encrypted media checkpoint without overflowing the stack or losing it', () => {
    crypto.path = mkdtempSync(join(tmpdir(), 'tray-checkpoint-'));
    const storage = new ProtectedCheckpoint();
    const payload = `private-media-${'A'.repeat(1_000_000)}`;
    storage.setItem('payload/plan-1', { data: payload });
    const file = join(crypto.path, 'protected-checkpoint');
    expect(readFileSync(file, 'utf8')).not.toContain('private-media-');
    expect(new ProtectedCheckpoint().getItem<{ data: string }>('payload/plan-1')?.data).toBe(payload);
    expect(existsSync(file)).toBe(true);
  });

  it('rejects noncanonical base64 without deleting the checkpoint', () => {
    crypto.path = mkdtempSync(join(tmpdir(), 'tray-checkpoint-'));
    const storage = new ProtectedCheckpoint();
    storage.setItem('secret', 'value');
    const file = join(crypto.path, 'protected-checkpoint');
    const encoded = readFileSync(file, 'utf8');
    writeFileSync(file, `${encoded}\n`);
    expect(() => storage.getItem('secret')).toThrow('corrupt');
    expect(readFileSync(file, 'utf8')).toBe(`${encoded}\n`);
  });

  it('denies insecure Linux fallback and unavailable encryption', () => {
    crypto.path = mkdtempSync(join(tmpdir(), 'tray-checkpoint-'));
    const storage = new ProtectedCheckpoint();
    crypto.available = false;
    expect(() => storage.setItem('secret', 'value')).toThrow('unavailable');
    crypto.available = true;
    if (process.platform === 'linux') {
      crypto.backend = 'basic_text';
      expect(() => storage.setItem('secret', 'value')).toThrow('unavailable');
    }
  });
});
