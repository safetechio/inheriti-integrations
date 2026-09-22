import { describe, expect, it } from 'vitest';
import type { SecretStorage } from 'vscode';
import { MASTER_KEY_PASSPHRASE_SECRET, SecretStorageMasterKeySource } from '../src/master-keys.js';

function secretStorage(value?: string): SecretStorage {
  return {
    get: async (key: string) => key === MASTER_KEY_PASSPHRASE_SECRET ? value : undefined,
  } as unknown as SecretStorage;
}

/**
 * This host declares custody and nothing else. Which key opens which plan, and whether to ask the
 * device holding it, is the Client SDK's decision and is covered by its suite.
 */
describe('VS Code master-key custody', () => {
  it('derives from the passphrase held in SecretStorage', async () => {
    const source = new SecretStorageMasterKeySource('00'.repeat(16), secretStorage('correct horse battery staple'));

    await expect(source.resolve()).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * Holding nothing is a real state, not a failure: an editor is composed at activation and the
   * operator may import a configuration later. The SDK asks the key holder instead.
   */
  it('holds nothing when the secret or the salt is absent', async () => {
    await expect(new SecretStorageMasterKeySource(undefined, secretStorage('secret')).resolve())
      .resolves.toBeUndefined();
    await expect(new SecretStorageMasterKeySource('00'.repeat(16), secretStorage()).resolve())
      .resolves.toBeUndefined();
  });

  it('reads the secret per resolve, so one stored after activation is picked up', async () => {
    let stored: string | undefined;
    const storage = { get: async () => stored } as unknown as SecretStorage;
    const source = new SecretStorageMasterKeySource('00'.repeat(16), storage);

    await expect(source.resolve()).resolves.toBeUndefined();
    stored = 'correct horse battery staple';
    await expect(source.resolve()).resolves.toMatch(/^[0-9a-f]{64}$/);
  });
});
