import type { ElectronHttpTransport } from '../transport/electron-http-transport';

export type AuthSessionStatus = 'IDLE' | 'CONFIRMING' | 'AUTHENTICATED' | 'EXPIRED' | 'ERROR';

interface SessionIdentity {
  sessionFamilyId: string;
  userId: string;
}

export interface AuthSessionDescriptor extends SessionIdentity {
  expiresAt: string;
}

export interface OrganizationKeyVaultContext extends SessionIdentity {
  organizationId: string;
}

export interface OrganizationKeyVault {
  get(context: OrganizationKeyVaultContext): Promise<string | null>;
  set(context: OrganizationKeyVaultContext, masterKey: string): Promise<void>;
  clearOrganization(context: OrganizationKeyVaultContext): Promise<void>;
  clearSession(sessionFamilyId: string): Promise<void>;
  clearAllSessions(): Promise<void>;
}

export type AuthAction = {
  type: 'SIGN_IN' | 'SIGN_OUT' | 'AUTH_READY';
  userData?: unknown;
};

export interface AuthProviderInstance {
  dispatch?: (action: AuthAction) => void;
}

export interface BusinessSocketLike {
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
  emit(event: string, payload?: unknown): void;
}

export interface OrganizationEventListener {
  subscribe(params: {
    organizationId: string;
    eventName: string;
    subscriptionKey: string;
    handlers: { onUpdated?: (data: unknown) => void };
  }): void;
  unsubscribe(params: { organizationId: string; eventName: string; subscriptionKey: string }): void;
}

export const ORGANIZATION_SOCKET_COMMANDS = {
  SUBSCRIBE_TENANT: 'subscribe_tenant',
  UNSUBSCRIBE_TENANT: 'unsubscribe_tenant',
  SUBSCRIBE_MASTER_KEY: 'subscribe_master_key_session',
  UNSUBSCRIBE_MASTER_KEY: 'unsubscribe_master_key_session',
} as const;

export const ORGANIZATION_SOCKET_EVENTS = {
  TENANT_CHANGED: 'tenant_changed',
  MASTER_KEY_DELIVERED: 'master_key_delivered',
} as const;

export interface RuntimeValue {
  transport: ElectronHttpTransport;
  vault: OrganizationKeyVault;
  authProvider: AuthProviderInstance;
  socket: BusinessSocketLike;
}
