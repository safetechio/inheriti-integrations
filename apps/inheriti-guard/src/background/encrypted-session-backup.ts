import type { OperatorSessionBackup } from './session-store.js';

const DATABASE = 'inheriti-guard-operator-session';
const BACKUP_KEY = 'inheriti.encryptedOperatorProfiles';
const STORE = 'keys';
const KEY = 'operator-profiles';
const AAD = new TextEncoder().encode(BACKUP_KEY);

export class InvalidOperatorSessionBackupError extends Error {
  public constructor() { super('invalid_operator_session_backup'); }
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function encryptionKey(): Promise<CryptoKey> {
  const db = await database();
  try {
    const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result as CryptoKey | undefined);
      request.onerror = () => reject(request.error);
    });
    if (existing) return existing;
    const created = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(created, KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    return created;
  } finally {
    db.close();
  }
}

export class EncryptedOperatorSessionBackup implements OperatorSessionBackup {
  public constructor(private readonly area: chrome.storage.StorageArea) {}

  public async load(): Promise<Awaited<ReturnType<OperatorSessionBackup['load']>>> {
    const value = (await this.area.get(BACKUP_KEY))[BACKUP_KEY];
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || !('iv' in value) || !('ciphertext' in value)
      || !Array.isArray(value.iv) || !Array.isArray(value.ciphertext)
      || value.iv.length !== 12 || !value.iv.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
      || !value.ciphertext.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255))
      throw new InvalidOperatorSessionBackupError();
    const key = await encryptionKey();
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(value.iv), additionalData: AAD },
        key, new Uint8Array(value.ciphertext));
      return JSON.parse(new TextDecoder().decode(plain)) as Awaited<ReturnType<OperatorSessionBackup['load']>>;
    } catch {
      throw new InvalidOperatorSessionBackupError();
    }
  }

  public async save(registry: Parameters<OperatorSessionBackup['save']>[0]): Promise<void> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD },
      await encryptionKey(), new TextEncoder().encode(JSON.stringify(registry)));
    await this.area.set({ [BACKUP_KEY]: { iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)) } });
  }

  public async clear(): Promise<void> { await this.area.remove(BACKUP_KEY); }
}
