import { argon2d, argon2id } from 'hash-wasm';
import * as kdbxweb from 'kdbxweb';

let configured = false;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function setupKdbxCrypto(): Promise<void> {
  if (configured) return;

  kdbxweb.CryptoEngine.argon2 = async (
    password,
    salt,
    memory,
    iterations,
    length,
    parallelism,
    type,
    _version,
  ) => {
    void _version;
    const hashFn = type === kdbxweb.CryptoEngine.Argon2TypeArgon2d ? argon2d : argon2id;
    const hash = await hashFn({
      password: new Uint8Array(password),
      salt: new Uint8Array(salt),
      parallelism,
      iterations,
      memorySize: memory,
      hashLength: length,
      outputType: 'binary',
    });
    return toArrayBuffer(hash);
  };

  configured = true;
}
