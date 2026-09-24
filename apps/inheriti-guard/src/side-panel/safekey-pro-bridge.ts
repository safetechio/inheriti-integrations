import { createBrowserSafeKeyProDevice } from '@safetech/inheriti-core-sdk/safekey-pro/browser';

type Request = { id: number; operation: 'choose' | 'prepare' | 'write' | 'read' | 'finish' | 'cancel'; rpId?: string; share?: unknown; request?: unknown };

const title = document.querySelector<HTMLElement>('#safekey-title')!;
const intro = document.querySelector<HTMLElement>('#safekey-intro')!;
const status = document.querySelector<HTMLElement>('#safekey-status')!;
const choice = document.querySelector<HTMLElement>('#safekey-choice')!;
const mobile = document.querySelector<HTMLButtonElement>('#safekey-mobile')!;
const pro = document.querySelector<HTMLButtonElement>('#safekey-pro')!;
const pinForm = document.querySelector<HTMLFormElement>('#safekey-pin-form')!;
const pinInput = document.querySelector<HTMLInputElement>('#safekey-pin')!;
const touch = document.querySelector<HTMLElement>('#safekey-touch')!;
const cancel = document.querySelector<HTMLButtonElement>('#safekey-cancel')!;

let cachedPin: string | undefined;
let pending: { reject: (error: Error) => void } | undefined;
let active: AbortController | undefined;
let device: ReturnType<typeof createBrowserSafeKeyProDevice> | undefined;
let deviceRpId: string | undefined;
let currentOperation: 'read' | 'write' = 'read';
let preparingPin = false;

function clear(): void {
  active?.abort(); active = undefined;
  pending?.reject(new Error('SAFEKEY_CANCELED')); pending = undefined;
  cachedPin = undefined;
  pinInput.value = '';
  device = undefined; deviceRpId = undefined;
}

function askChoice(): Promise<'SK_MOBILE' | 'SK_PRO'> {
  choice.hidden = false; pinForm.hidden = true; touch.hidden = true;
  title.textContent = 'Choose a custodian device';
  intro.textContent = 'Save the plan share to a device for this and future access.';
  status.textContent = '';
  return new Promise((resolve, reject) => {
    pending = { reject };
    mobile.onclick = () => { pending = undefined; choice.hidden = true; status.textContent = 'Continue in SafeKey Mobile.'; resolve('SK_MOBILE'); };
    pro.onclick = () => { pending = undefined; choice.hidden = true; status.textContent = 'Waiting for SafeKey Pro…'; resolve('SK_PRO'); };
  });
}

function askPin(onSubmit?: () => void): Promise<string> {
  if (cachedPin) return Promise.resolve(cachedPin);
  choice.hidden = true; pinForm.hidden = false; touch.hidden = true;
  title.textContent = currentOperation === 'write' ? 'Save to SafeKey Pro' : 'Collect from SafeKey Pro';
  intro.textContent = currentOperation === 'write'
    ? 'Enter your PIN to save the custodian share to your device.'
    : 'Enter your PIN to read the custodian share from your device.';
  status.textContent = 'Your PIN stays in this InheritiGuard window.';
  pinInput.focus();
  return new Promise((resolve, reject) => {
    pending = { reject };
    pinForm.onsubmit = (event) => {
      event.preventDefault();
      onSubmit?.();
      cachedPin = pinInput.value;
      pinInput.value = '';
      pinForm.hidden = true;
      pending = undefined;
      status.textContent = 'Follow the SafeKey PRO touch prompts.';
      resolve(cachedPin);
    };
  });
}

function validRpId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 253 && value === value.toLowerCase()
    && !value.includes('..') && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value)
    && value.split('.').every((label) => label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'));
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^SAFEKEY_[A-Z_]+$/.test(message) ? message : 'SAFEKEY_DEVICE_FAILED';
}

export function connectSafeKeyProPanel(): void {
  const port = chrome.runtime.connect({ name: 'inheriti-safekey-pro' });
  const cancelReveal = () => {
    if (preparingPin) { window.close(); return; }
    clear();
    try { port.postMessage({ operation: 'cancel-reveal' }); } catch { /* The worker has stopped. */ }
    window.close();
  };
  cancel.addEventListener('click', cancelReveal);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') cancelReveal(); });
  port.onDisconnect.addListener(() => { clear(); window.close(); });
  port.onMessage.addListener((message: Request) => {
    if (!message || !Number.isSafeInteger(message.id)) return;
    if (message.operation === 'cancel' || message.operation === 'finish') {
      clear(); port.postMessage({ id: message.id, ok: true, value: undefined });
      if (message.operation === 'finish') window.close();
      return;
    }
    void (async () => {
      try {
        if (message.operation === 'choose') {
          port.postMessage({ id: message.id, ok: true, value: await askChoice() }); return;
        }
        if (message.operation === 'prepare') {
          currentOperation = 'write';
          preparingPin = true;
          await askPin(() => { preparingPin = false; port.postMessage({ operation: 'pin-confirmed' }); });
          preparingPin = false;
          port.postMessage({ id: message.id, ok: true, value: true }); return;
        }
        if (message.operation !== 'read' && message.operation !== 'write') throw new Error('SAFEKEY_DEVICE_FAILED');
        currentOperation = message.operation;
        if (!validRpId(message.rpId) || (deviceRpId && deviceRpId !== message.rpId)) throw new Error('SAFEKEY_DEVICE_FAILED');
        deviceRpId = message.rpId;
        device ??= createBrowserSafeKeyProDevice({
          rpId: message.rpId,
          getPin: () => askPin(),
          onTouch: () => {
            pinForm.hidden = true; touch.hidden = false;
            title.textContent = 'Confirm on SafeKey Pro';
            intro.textContent = 'Keep your device connected while InheritiGuard opens the plan.';
            status.textContent = 'Press and release when Chrome asks. Several touches may be needed.';
          },
        });
        active = new AbortController();
        const value = message.operation === 'write'
          ? await device.write(message.share as Parameters<typeof device.write>[0], active.signal)
          : await device.read(message.request as Parameters<typeof device.read>[0], active.signal);
        active = undefined;
        port.postMessage({ id: message.id, ok: true, value });
      } catch (error) {
        active = undefined;
        try { port.postMessage({ id: message.id, ok: false, error: errorCode(error) }); }
        catch { /* The secure window closed before it could answer. */ }
      }
    })();
  });
}
