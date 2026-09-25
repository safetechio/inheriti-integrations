import { createNodeSafeKeyProDevice } from '@safetech/inheriti-core-sdk/node';
import { createSafeKeyProPinSession, custodianShareCopy, waitForSafeKeyProDevice } from '@safetech/inheriti-elements-core/node';
import type { CliConfiguration } from './configuration.js';
import type { Terminal } from './output.js';
import { promptSelect } from './render/select.jsx';
import { requestCliCancel } from './cancellation.js';

export function createCliSafeKeyPro(configuration: CliConfiguration) {
  if (!configuration.safeKeyProRpId) return undefined;
  const pinSession = createSafeKeyProPinSession(readHiddenPin);
  const connect = async (signal?: AbortSignal) => {
    deviceStatus(custodianShareCopy.choice.proConnect);
    const device = await waitForSafeKeyProDevice(configuration.safeKeyProDevice, signal);
    let shown = false;
    return createNodeSafeKeyProDevice({
      device,
      rpId: configuration.safeKeyProRpId!,
      getPin: pinSession.getPin,
      onTouch: (operation, attempt, limit) => {
        const message = `SafeKey PRO ${operation} ${attempt}/${limit}: ${custodianShareCopy.choice.proTouch}`;
        if (process.stderr.isTTY) deviceStatus(message);
        else if (!shown) process.stderr.write(`${message}\n`);
        shown = true;
      },
    });
  };
  return {
    clearPin: pinSession.clearPin,
    write: async (share: Parameters<ReturnType<typeof createNodeSafeKeyProDevice>['write']>[0], signal?: AbortSignal) => {
      try { return await (await connect(signal)).write(share, signal); }
      finally { if (process.stderr.isTTY) process.stderr.write('\r\x1b[2K'); }
    },
    read: async (request: Parameters<ReturnType<typeof createNodeSafeKeyProDevice>['read']>[0], signal?: AbortSignal) => {
      try { return await (await connect(signal)).read(request, signal); }
      finally { if (process.stderr.isTTY) process.stderr.write('\r\x1b[2K'); }
    },
  };
}

export async function selectCliCustodianDevice(terminal: Terminal, signal?: AbortSignal): Promise<'SK_MOBILE' | 'SK_PRO'> {
  if (!terminal.interactive) return 'SK_MOBILE';
  terminal.write(custodianShareCopy.choice.intro);
  const choice = await promptSelect(custodianShareCopy.choice.question, [
    { value: 'SK_MOBILE', label: custodianShareCopy.choice.mobileOption, description: custodianShareCopy.choice.mobileDescription },
    { value: 'SK_PRO', label: custodianShareCopy.choice.proOption, description: custodianShareCopy.choice.proDescription },
  ], signal);
  if (!choice || signal?.aborted) throw Object.assign(new Error('reveal_canceled'), { name: 'AbortError' });
  if (choice === 'SK_MOBILE') return choice;
  const confirmed = await promptSelect(custodianShareCopy.choice.proConnect, [
    { value: 'SK_PRO', label: 'Continue with SafeKey PRO', description: 'Connect the device, then press Enter.' },
    { value: 'SK_MOBILE', label: 'Choose SafeKey Mobile', description: custodianShareCopy.choice.mobileDescription },
  ], signal);
  if (!confirmed || signal?.aborted) throw Object.assign(new Error('reveal_canceled'), { name: 'AbortError' });
  return confirmed as 'SK_MOBILE' | 'SK_PRO';
}

function deviceStatus(message: string): void {
  process.stderr.write(process.stderr.isTTY ? `\r\x1b[2K${message}` : `${message}\n`);
}

export async function readHiddenPin(signal?: AbortSignal): Promise<Uint8Array> {
  const input = process.stdin;
  if (!input.isTTY || !input.setRawMode) throw Object.assign(new Error('SAFEKEY_INTERACTIVE_REQUIRED'), { code: 'SAFEKEY_INTERACTIVE_REQUIRED' });
  if (signal?.aborted) throw Object.assign(new Error('SAFEKEY_ABORTED'), { code: 'SAFEKEY_ABORTED' });
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.ref?.();
  input.resume();
  const bytes: number[] = [];
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      const cleanup = () => { input.off('data', onData); signal?.removeEventListener('abort', onAbort); };
      const onAbort = () => {
        cleanup();
        if (process.stderr.isTTY) process.stderr.write('\r\x1b[2K');
        reject(Object.assign(new Error('SAFEKEY_ABORTED'), { code: 'SAFEKEY_ABORTED' }));
      };
      const onData = (chunk: Buffer | string) => {
        const data = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        for (const byte of data) {
          if (byte === 3 || byte === 27) { requestCliCancel(); if (!signal?.aborted) onAbort(); return; }
          if (byte === 13 || byte === 10) {
            cleanup();
            deviceStatus('PIN entered. Waiting for SafeKey PRO...');
            if (process.stderr.isTTY) process.stderr.write('\n');
            resolve(Uint8Array.from(bytes));
            return;
          }
          if (byte === 127 || byte === 8) bytes.pop();
          else if (byte >= 32 && byte <= 126 && bytes.length < 128) bytes.push(byte);
          else continue;
          if (process.stderr.isTTY) deviceStatus(`SafeKey PRO PIN (press Enter): ${'*'.repeat(bytes.length)}`);
        }
      };
      input.on('data', onData);
      signal?.addEventListener('abort', onAbort, { once: true });
      deviceStatus('SafeKey PRO PIN (press Enter): ');
    });
  } finally {
    bytes.fill(0);
    input.setRawMode(Boolean(wasRaw));
    input.pause();
    input.unref?.();
  }
}
