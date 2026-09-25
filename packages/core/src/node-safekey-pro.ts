import { accessSync, constants, readdirSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

export function findSafeKeyProDevice(sysfs = '/sys/class/hidraw', devices = '/dev'): string | undefined {
  try {
    for (const name of readdirSync(sysfs).filter(name => /^hidraw\d+$/.test(name))) {
      if (!/^HID_ID=0003:000020A0:000042B3$/m.test(readFileSync(`${sysfs}/${name}/device/uevent`, 'utf8'))) continue;
      const path = `${devices}/${name}`;
      accessSync(path, constants.R_OK | constants.W_OK);
      return path;
    }
  } catch { return undefined; }
  return undefined;
}

export async function waitForSafeKeyProDevice(configuredPath?: string, signal?: AbortSignal): Promise<string> {
  const current = () => {
    if (!configuredPath) return findSafeKeyProDevice();
    try { accessSync(configuredPath, constants.R_OK | constants.W_OK); return configuredPath; }
    catch { return undefined; }
  };
  let device = current();
  for (let attempt = 0; !device && attempt < 180; attempt++) {
    await delay(1_000, undefined, { signal });
    device = current();
  }
  if (!device) throw new Error('SAFEKEY_DEVICE_NOT_CONNECTED');
  return device;
}

export function createSafeKeyProPinSession(prompt: (signal?: AbortSignal) => Promise<Uint8Array>) {
  let pin: Uint8Array | undefined;
  return {
    getPin: async (signal?: AbortSignal) => {
      if (signal?.aborted) throw new Error('SAFEKEY_ABORTED');
      if (pin) return pin.slice();
      const entered = await prompt(signal);
      if (signal?.aborted) { entered.fill(0); throw new Error('SAFEKEY_ABORTED'); }
      pin = entered.slice();
      return entered;
    },
    clearPin: () => { pin?.fill(0); pin = undefined; },
  };
}
