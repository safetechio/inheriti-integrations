import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EncryptedOperatorSessionBackup, InvalidOperatorSessionBackupError } from '../src/background/encrypted-session-backup.js';
import { SessionStorageOperatorSessionStore, type OperatorSessionBackup } from '../src/background/session-store.js';

const records = new Map<string, unknown>();
const local = new Map<string, unknown>();

beforeEach(() => {
  records.clear();
  local.clear();
  const db = {
    createObjectStore() {},
    close() {},
    transaction() {
      const transaction = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        objectStore: () => ({
          get: (key: string) => {
            const request = { result: records.get(key), onsuccess: null as (() => void) | null,
              onerror: null as (() => void) | null };
            queueMicrotask(() => request.onsuccess?.());
            return request;
          },
          put: (value: unknown, key: string) => {
            records.set(key, value);
            queueMicrotask(() => transaction.oncomplete?.());
          },
        }),
      };
      return transaction;
    },
  };
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request = { result: db, onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
      queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
      return request;
    },
  });
});

describe('encrypted operator session backup', () => {
  it('persists only ciphertext, reuses a nonextractable key, rejects tampering, and clears the record', async () => {
    const area = {
      get: async (key: string) => ({ [key]: local.get(key) }),
      set: async (values: Record<string, unknown>) => { for (const [key, value] of Object.entries(values)) local.set(key, value); },
      remove: async (key: string) => { local.delete(key); },
    } as unknown as chrome.storage.StorageArea;
    const backup = new EncryptedOperatorSessionBackup(area);
    const registry = { profiles: [], generation: 2, marker: 'secret-token' } as unknown as Parameters<OperatorSessionBackup['save']>[0];
    await backup.save(registry);
    expect(JSON.stringify([...local.values()])).not.toContain('secret-token');
    expect([...records.values()][0]).toMatchObject({ extractable: false });
    expect(await new EncryptedOperatorSessionBackup(area).load()).toEqual(registry);

    const value = [...local.values()][0] as { iv: number[]; ciphertext: number[] };
    value.ciphertext[0] = value.ciphertext[0]! ^ 1;
    await expect(new EncryptedOperatorSessionBackup(area).load()).rejects.toBeInstanceOf(InvalidOperatorSessionBackupError);
    const sessionArea = { get: async () => ({}), set: async () => undefined, remove: async () => undefined } as unknown as chrome.storage.StorageArea;
    expect(await new SessionStorageOperatorSessionStore(sessionArea, backup).load()).toBeUndefined();
    expect(await backup.load()).toBeUndefined();
  });
});
