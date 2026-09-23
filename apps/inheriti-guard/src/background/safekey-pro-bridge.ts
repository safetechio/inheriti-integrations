import type { ScopedRevealOptions } from '@safetech/inheriti-elements-core/browser';

type ProDevice = NonNullable<ScopedRevealOptions['proDevice']>;
type Reply = { id: number; ok: boolean; value?: unknown; error?: string };

export class SafeKeyProPanelBridge {
  private port: chrome.runtime.Port | undefined;
  private popupId: number | undefined;
  private opening: Promise<chrome.runtime.Port> | undefined;
  private connected: ((port: chrome.runtime.Port) => void) | undefined;
  private finishing = false;
  private sequence = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

  constructor(private readonly onDisconnect: () => void) {}

  attach(port: chrome.runtime.Port): void {
    if (port.name !== 'inheriti-safekey-pro' || port.sender?.id !== chrome.runtime.id
      || port.sender.url !== chrome.runtime.getURL('safekey-popup/index.html')) {
      port.disconnect();
      return;
    }
    if (!this.connected || this.finishing) { port.disconnect(); return; }
    if (this.port) {
      for (const waiting of this.pending.values()) waiting.reject(new Error('SAFEKEY_PANEL_CLOSED'));
      this.pending.clear();
      this.port.disconnect();
      this.onDisconnect();
    }
    this.port = port;
    this.connected?.(port);
    this.connected = undefined;
    port.onMessage.addListener((reply: Reply | { operation: 'cancel-reveal' }) => {
      if (this.port === port && reply && 'operation' in reply && reply.operation === 'cancel-reveal') { this.onDisconnect(); return; }
      if (this.port !== port || !reply || !('id' in reply) || !Number.isSafeInteger(reply.id) || typeof reply.ok !== 'boolean') return;
      const waiting = this.pending.get(reply.id);
      if (!waiting) return;
      this.pending.delete(reply.id);
      if (reply.ok) waiting.resolve(reply.value);
      else waiting.reject(new Error(typeof reply.error === 'string' && /^SAFEKEY_[A-Z_]+$/.test(reply.error)
        ? reply.error : 'SAFEKEY_DEVICE_FAILED'));
    });
    port.onDisconnect.addListener(() => {
      if (this.port !== port) return;
      this.port = undefined;
      for (const waiting of this.pending.values()) waiting.reject(new Error('SAFEKEY_PANEL_CLOSED'));
      this.pending.clear();
      if (!this.finishing) this.onDisconnect();
    });
  }

  async choose(signal?: AbortSignal): Promise<'SK_MOBILE' | 'SK_PRO'> {
    const value = await this.call('choose', {}, signal);
    if (value !== 'SK_MOBILE' && value !== 'SK_PRO') throw new Error('SAFEKEY_DEVICE_FAILED');
    return value;
  }

  device(rpId: string): ProDevice {
    return {
      write: async (share: Parameters<ProDevice['write']>[0], signal?: AbortSignal) =>
        this.call('write', { share, rpId }, signal) as ReturnType<ProDevice['write']>,
      read: async (request: Parameters<ProDevice['read']>[0], signal?: AbortSignal) =>
        this.call('read', { request, rpId }, signal) as ReturnType<ProDevice['read']>,
    };
  }

  finish(): void {
    this.finishing = true;
    try { this.port?.postMessage({ id: ++this.sequence, operation: 'finish' }); }
    catch { /* The panel closed while the reveal was finishing. */ }
    this.port = undefined;
    if (this.popupId !== undefined) void chrome.windows.remove(this.popupId).catch(() => undefined);
    this.popupId = undefined;
  }

  private async ready(): Promise<chrome.runtime.Port> {
    if (this.port) return this.port;
    this.opening ??= new Promise<chrome.runtime.Port>((resolve, reject) => {
      this.finishing = false;
      const timeout = setTimeout(() => {
        this.connected = undefined;
        this.finishing = true;
        if (this.popupId !== undefined) void chrome.windows.remove(this.popupId).catch(() => undefined);
        reject(new Error('SAFEKEY_PANEL_CLOSED'));
      }, 15000);
      this.connected = (port) => { clearTimeout(timeout); resolve(port); };
      void chrome.windows.create({ url: chrome.runtime.getURL('safekey-popup/index.html'), type: 'popup', width: 430, height: 590, focused: true })
        .then((window) => {
          if (window?.id === undefined) throw new Error('SAFEKEY_PANEL_CLOSED');
          this.popupId = window.id;
          if (this.finishing) void chrome.windows.remove(window.id).catch(() => undefined);
        })
        .catch(() => { clearTimeout(timeout); this.connected = undefined; reject(new Error('SAFEKEY_PANEL_CLOSED')); });
    }).finally(() => { this.opening = undefined; });
    return this.opening;
  }

  private async call(operation: 'choose' | 'write' | 'read', payload: object, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(new Error('SAFEKEY_ABORTED'));
    const port = await this.ready();
    if (signal?.aborted) throw new Error('SAFEKEY_ABORTED');
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.pending.delete(id);
        try { port.postMessage({ id, operation: 'cancel' }); }
        catch { /* A disconnected panel has no operation left to cancel. */ }
        reject(new Error('SAFEKEY_ABORTED'));
      };
      this.pending.set(id, {
        resolve: value => { signal?.removeEventListener('abort', onAbort); resolve(value); },
        reject: error => { signal?.removeEventListener('abort', onAbort); reject(error); },
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      try { port.postMessage({ id, operation, ...payload }); }
      catch { this.pending.delete(id); signal?.removeEventListener('abort', onAbort); reject(new Error('SAFEKEY_PANEL_CLOSED')); }
    });
  }
}
