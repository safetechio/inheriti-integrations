import {
  ORGANIZATION_SOCKET_COMMANDS,
  ORGANIZATION_SOCKET_EVENTS,
} from '@shared/infrastructure/importer-api';
import type { BusinessSocketLike } from '@shared/infrastructure/importer-api';

type Handler = (...args: unknown[]) => void;

/** Renderer-side socket adapter. Credentials and the real Socket.IO client stay in Electron main. */
export class ElectronBusinessSocket implements BusinessSocketLike {
  private handlers = new Map<string, Set<Handler>>();
  private detachBridge: (() => void) | null = null;

  on(event: string, handler: Handler): void {
    let eventHandlers = this.handlers.get(event);
    if (!eventHandlers) {
      eventHandlers = new Set();
      this.handlers.set(event, eventHandlers);
    }
    eventHandlers.add(handler);
    if (!this.detachBridge) {
      this.detachBridge =
        window.inheriti?.socket?.onEvent((message) => {
          this.handlers.get(message.event)?.forEach((listener) => listener(message.data));
        }) ?? null;
    }
  }

  off(event: string, handler: Handler): void {
    const eventHandlers = this.handlers.get(event);
    eventHandlers?.delete(handler);
    if (eventHandlers?.size === 0) this.handlers.delete(event);
    if (this.handlers.size === 0) {
      this.detachBridge?.();
      this.detachBridge = null;
    }
  }

  emit(event: string, payload?: unknown): void {
    const socket = window.inheriti?.socket;
    if (
      event === ORGANIZATION_SOCKET_COMMANDS.SUBSCRIBE_TENANT ||
      event === ORGANIZATION_SOCKET_COMMANDS.SUBSCRIBE_MASTER_KEY
    ) {
      void socket?.subscribe({
        event:
          event === ORGANIZATION_SOCKET_COMMANDS.SUBSCRIBE_TENANT
            ? ORGANIZATION_SOCKET_EVENTS.TENANT_CHANGED
            : ORGANIZATION_SOCKET_EVENTS.MASTER_KEY_DELIVERED,
        payload: payload as Record<string, string>,
      });
    }
    if (
      event === ORGANIZATION_SOCKET_COMMANDS.UNSUBSCRIBE_TENANT ||
      event === ORGANIZATION_SOCKET_COMMANDS.UNSUBSCRIBE_MASTER_KEY
    ) {
      void socket?.unsubscribe({
        event:
          event === ORGANIZATION_SOCKET_COMMANDS.UNSUBSCRIBE_TENANT
            ? ORGANIZATION_SOCKET_EVENTS.TENANT_CHANGED
            : ORGANIZATION_SOCKET_EVENTS.MASTER_KEY_DELIVERED,
        payload: payload as Record<string, string>,
      });
    }
  }
}
