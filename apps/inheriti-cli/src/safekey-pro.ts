import { createNodeSafeKeyProDevice } from '@safetech/inheriti-core-sdk/node';
import type { CliConfiguration } from './configuration.js';
import type { Terminal } from './output.js';
import { promptSelect } from './render/select.jsx';

export function createCliSafeKeyPro(configuration: CliConfiguration) {
  if (!configuration.safeKeyProDevice || !configuration.safeKeyProRpId) return undefined;
  return createNodeSafeKeyProDevice({
    device: configuration.safeKeyProDevice,
    rpId: configuration.safeKeyProRpId,
    getPin: readHiddenPin,
    onTouch: (operation, attempt, limit) => {
      process.stderr.write(`SafeKey PRO ${operation} ${attempt}/${limit}: press and release the touch button.\n`);
    },
  });
}

export async function selectCliCustodianDevice(terminal: Terminal, signal?: AbortSignal): Promise<'SK_MOBILE' | 'SK_PRO'> {
  if (!terminal.interactive) return 'SK_MOBILE';
  const choice = await promptSelect('Where should this plan share be stored?', [
    { value: 'SK_MOBILE', description: 'SafeKey Mobile' },
    { value: 'SK_PRO', description: 'SafeKey PRO (connected locally)' },
  ], signal);
  if (!choice || signal?.aborted) throw Object.assign(new Error('reveal_canceled'), { name: 'AbortError' });
  return choice as 'SK_MOBILE' | 'SK_PRO';
}

export async function readHiddenPin(signal?: AbortSignal): Promise<Uint8Array> {
  const input = process.stdin;
  if (!input.isTTY || !input.setRawMode) throw Object.assign(new Error('SAFEKEY_INTERACTIVE_REQUIRED'), { code: 'SAFEKEY_INTERACTIVE_REQUIRED' });
  if (signal?.aborted) throw Object.assign(new Error('SAFEKEY_ABORTED'), { code: 'SAFEKEY_ABORTED' });
  process.stderr.write('SafeKey PRO PIN: ');
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  const bytes: number[] = [];
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      const cleanup = () => { input.off('data', onData); signal?.removeEventListener('abort', onAbort); };
      const onAbort = () => { cleanup(); reject(Object.assign(new Error('SAFEKEY_ABORTED'), { code: 'SAFEKEY_ABORTED' })); };
      const onData = (chunk: Buffer) => {
        for (const byte of chunk) {
          if (byte === 3 || byte === 27) { onAbort(); return; }
          if (byte === 13 || byte === 10) { cleanup(); resolve(Uint8Array.from(bytes)); return; }
          if (byte === 127 || byte === 8) { bytes.pop(); continue; }
          if (byte >= 32 && byte <= 126 && bytes.length < 128) bytes.push(byte);
        }
      };
      input.on('data', onData);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  } finally {
    bytes.fill(0);
    input.setRawMode(Boolean(wasRaw));
    input.pause();
    process.stderr.write('\n');
  }
}
