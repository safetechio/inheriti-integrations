import { businessUiRpId, createNodeSafeKeyProDevice, createSafeKeyProPinSession, waitForSafeKeyProDevice } from '@safetech/inheriti-elements-core/node';
import type { Deployment } from '../../launcher/main/state.js';
import { CustodianPrompt } from './custodian-prompt.js';

export function createTraySafeKeyPro(deployment: Deployment, prompt: CustodianPrompt) {
  if (process.platform !== 'linux') return undefined;
  const rpId = businessUiRpId(deployment);
  if (!rpId) return undefined;
  let firstAccess = false;
  const active = new Set<AbortController>();
  const pin = createSafeKeyProPinSession((signal) => prompt.readPin(firstAccess, signal));
  const connect = async (signal?: AbortSignal) => {
    prompt.connect(firstAccess);
    return createNodeSafeKeyProDevice({
      device: await waitForSafeKeyProDevice(process.env.INHERITI_SAFEKEY_PRO_DEVICE, signal),
      rpId,
      getPin: pin.getPin,
      onTouch: (operation, attempt, limit) => prompt.touch(firstAccess, operation, attempt, limit),
    });
  };
  const run = async <T>(signal: AbortSignal | undefined, work: (device: ReturnType<typeof createNodeSafeKeyProDevice>, activeSignal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    active.add(controller);
    try { return await work(await connect(controller.signal), controller.signal); }
    finally { active.delete(controller); signal?.removeEventListener('abort', abort); }
  };
  return {
    write: async (share: Parameters<ReturnType<typeof createNodeSafeKeyProDevice>['write']>[0], signal?: AbortSignal) => {
      firstAccess = true;
      return run(signal, (device, activeSignal) => device.write(share, activeSignal));
    },
    read: async (request: Parameters<ReturnType<typeof createNodeSafeKeyProDevice>['read']>[0], signal?: AbortSignal) =>
      run(signal, (device, activeSignal) => device.read(request, activeSignal)),
    clearPin: () => { for (const controller of active) controller.abort(); pin.clearPin(); firstAccess = false; prompt.clear(); },
  };
}
