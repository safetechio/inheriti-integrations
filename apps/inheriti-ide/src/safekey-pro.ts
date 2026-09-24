import { createNodeSafeKeyProDevice } from '@safetech/inheriti-core-sdk/node';
import { createSafeKeyProPinSession, waitForSafeKeyProDevice } from '@safetech/inheriti-elements-core/node';
import type { ExtensionConfiguration } from './configuration.js';

function canceled(): Error { return Object.assign(new Error('reveal_canceled'), { name: 'AbortError' }); }

export function createIdeSafeKeyPro(configuration: ExtensionConfiguration, ui: {
  readPin(signal?: AbortSignal): Promise<string | undefined>;
  touch(operation: 'login' | 'read' | 'write', attempt: number, limit: number): void;
}) {
  if (!configuration.safeKeyProRpId) return undefined;
  const rpId = configuration.safeKeyProRpId;
  const pinSession = createSafeKeyProPinSession(async (signal) => {
    if (signal?.aborted) throw new Error('SAFEKEY_ABORTED');
    const pin = await ui.readPin(signal);
    if (!pin || signal?.aborted) throw new Error('SAFEKEY_ABORTED');
    return new TextEncoder().encode(pin);
  });
  const connect = async (signal?: AbortSignal) => createNodeSafeKeyProDevice({
    device: await waitForSafeKeyProDevice(configuration.safeKeyProDevice, signal),
    rpId,
    getPin: pinSession.getPin,
    onTouch: ui.touch,
  });
  return {
    clearPin: pinSession.clearPin,
    write: async (share: Parameters<ReturnType<typeof createNodeSafeKeyProDevice>['write']>[0], signal?: AbortSignal) =>
      (await connect(signal)).write(share, signal),
    read: async (request: Parameters<ReturnType<typeof createNodeSafeKeyProDevice>['read']>[0], signal?: AbortSignal) =>
      (await connect(signal)).read(request, signal),
  };
}

export async function selectIdeCustodianDevice(
  pick: (signal?: AbortSignal) => Promise<'SK_MOBILE' | 'SK_PRO' | undefined>, signal?: AbortSignal,
): Promise<'SK_MOBILE' | 'SK_PRO'> {
  if (signal?.aborted) throw canceled();
  const choice = await pick(signal);
  if (!choice || signal?.aborted) throw canceled();
  return choice;
}
