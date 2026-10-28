import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ORGANIZATION_SOCKET_COMMANDS,
  type AuthAction,
  type AuthSessionDescriptor,
  type AuthSessionStatus,
  type BusinessSocketLike,
  type OrganizationEventListener,
  type RuntimeValue,
} from './contracts';

const RuntimeContext = createContext<RuntimeValue | null>(null);
const AuthContext = createContext({ authInitialized: false, isLoggedIn: false, notice: null as string | null, accountsRevision: 0 });
type SessionValue = {
  status: AuthSessionStatus;
  session: AuthSessionDescriptor | null;
  confirmSession: () => Promise<void>;
};
const SessionContext = createContext<SessionValue | null>(null);
const SESSION_RECONFIRM_MS = 5 * 60 * 1000;

export function createCoreSessionBridge() {
  let session: AuthSessionDescriptor | null = null;
  const listeners = new Set<(active: boolean) => void | Promise<void>>();
  const activeSession = () =>
    session && new Date(session.expiresAt).getTime() > Date.now() ? session : null;
  const deliver = (listener: (active: boolean) => void | Promise<void>, active: boolean) => {
    try {
      void Promise.resolve(listener(active)).catch(() =>
        console.error('Core session synchronization failed'),
      );
    } catch {
      console.error('Core session synchronization failed');
    }
  };
  const notify = (active: boolean) => {
    for (const listener of listeners) deliver(listener, active);
  };
  return {
    getIdentityId: async () => activeSession()?.userId,
    subscribeAuthState: (listener: (active: boolean) => void | Promise<void>) => {
      listeners.add(listener);
      deliver(listener, Boolean(activeSession()));
      return () => listeners.delete(listener);
    },
    update: (status: AuthSessionStatus, descriptor: AuthSessionDescriptor | null) => {
      const next =
        (status === 'AUTHENTICATED' || status === 'CONFIRMING') &&
        descriptor &&
        new Date(descriptor.expiresAt).getTime() > Date.now()
          ? descriptor
          : null;
      if (session?.sessionFamilyId === next?.sessionFamilyId && session?.userId === next?.userId)
        return;
      if (session) notify(false);
      session = next;
      if (session) notify(true);
    },
  };
}

export function ImporterApiProvider({
  children,
  transport,
  vault,
  authProvider,
  socket,
  onSessionChange,
}: RuntimeValue & {
  children: ReactNode;
  onSessionChange?: (status: AuthSessionStatus, session: AuthSessionDescriptor | null) => void;
}) {
  const [auth, dispatch] = useReducer(
    (state: { authInitialized: boolean; isLoggedIn: boolean; notice: string | null; accountsRevision: number }, action: AuthAction) => {
      if (action.type === 'SIGN_IN') return { authInitialized: true, isLoggedIn: true, notice: null, accountsRevision: state.accountsRevision };
      if (action.type === 'SIGN_OUT') return { authInitialized: true, isLoggedIn: false, notice: null, accountsRevision: state.accountsRevision };
      if (action.type === 'NOTICE') return { authInitialized: true, isLoggedIn: state.isLoggedIn, notice: String(action.userData ?? ''), accountsRevision: state.accountsRevision };
      if (action.type === 'ACCOUNTS_CHANGED') return { authInitialized: state.authInitialized, isLoggedIn: state.isLoggedIn, notice: state.notice, accountsRevision: state.accountsRevision + 1 };
      return { authInitialized: true, isLoggedIn: state.isLoggedIn, notice: state.notice, accountsRevision: state.accountsRevision };
    },
    { authInitialized: false, isLoggedIn: false, notice: null, accountsRevision: 0 },
  );
  const [sessionState, setSessionState] = useState<{
    status: AuthSessionStatus;
    session: AuthSessionDescriptor | null;
  }>({ status: 'IDLE', session: null });
  const sessionRef = useRef<AuthSessionDescriptor | null>(null);
  const confirmationRef = useRef<Promise<void> | null>(null);
  const confirmedAtRef = useRef(0);
  const authEpochRef = useRef(0);
  sessionRef.current = sessionState.session;
  useEffect(() => {
    onSessionChange?.(sessionState.status, sessionState.session);
  }, [onSessionChange, sessionState]);
  const confirmSession = useCallback(() => {
    if (confirmationRef.current) return confirmationRef.current;
    const epoch = authEpochRef.current;
    const confirmation = (async () => {
      setSessionState((current) => ({ status: 'CONFIRMING', session: current.session }));
      const response = await transport.request<{ result?: unknown }>({
        method: 'GET',
        path: '/user/session',
        returnErrorResponse: true,
      });
      if (epoch !== authEpochRef.current) return;
      if (response.status === 401 || response.status === 403) {
        const previous = sessionRef.current;
        if (previous) await vault.clearSession(previous.sessionFamilyId);
        setSessionState({ status: 'EXPIRED', session: null });
        return;
      }
      if (response.status < 200 || response.status >= 300) {
        setSessionState((current) => ({ status: 'ERROR', session: current.session }));
        return;
      }
      const next = parseSessionDescriptor(response.body.result);
      if (!next) {
        const previous = sessionRef.current;
        if (previous) await vault.clearSession(previous.sessionFamilyId);
        setSessionState({ status: 'EXPIRED', session: null });
        return;
      }
      const previous = sessionRef.current;
      if (previous && previous.sessionFamilyId !== next.sessionFamilyId) {
        await vault.clearSession(previous.sessionFamilyId);
      }
      confirmedAtRef.current = Date.now();
      setSessionState({ status: 'AUTHENTICATED', session: next });
    })()
      .catch(() => {
        if (epoch !== authEpochRef.current) return;
        setSessionState((current) => ({ status: 'ERROR', session: current.session }));
      })
      .finally(() => {
        if (confirmationRef.current === confirmation) confirmationRef.current = null;
      });
    confirmationRef.current = confirmation;
    return confirmation;
  }, [transport, vault]);
  useEffect(() => {
    void confirmSession();
  }, [confirmSession]);
  useEffect(() => {
    const reconfirm = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - confirmedAtRef.current < SESSION_RECONFIRM_MS) return;
      void confirmSession();
    };
    document.addEventListener('visibilitychange', reconfirm);
    return () => document.removeEventListener('visibilitychange', reconfirm);
  }, [confirmSession]);
  const handleAuthAction = useCallback(
    (action: AuthAction) => {
      dispatch(action);
      if (action.type === 'SIGN_IN') {
        authEpochRef.current += 1;
        confirmationRef.current = null;
        void confirmSession();
      }
      if (action.type === 'SIGN_OUT') {
        authEpochRef.current += 1;
        confirmationRef.current = null;
        confirmedAtRef.current = 0;
        sessionRef.current = null;
        setSessionState({ status: 'IDLE', session: null });
        void vault.clearAllSessions();
      }
    },
    [confirmSession, vault],
  );
  authProvider.dispatch = handleAuthAction;
  return (
    <RuntimeContext.Provider value={{ transport, vault, authProvider, socket }}>
      <AuthContext.Provider value={auth}>
        <SessionContext.Provider
          value={{
            status: sessionState.status,
            session: sessionState.session,
            confirmSession,
          }}
        >
          {children}
        </SessionContext.Provider>
      </AuthContext.Provider>
    </RuntimeContext.Provider>
  );
}

export function useRuntime(): RuntimeValue {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('ImporterApiProvider is missing');
  return runtime;
}

export function useAuthProvider() {
  return useRuntime().authProvider;
}

export function useAuthState<T>(selector: (state: unknown) => T): T {
  return selector(useContext(AuthContext));
}

export function useService<T>(name: 'OrganizationKeyVault' | 'OrganizationEventListener'): T {
  const runtime = useRuntime();
  const organizationEventListener = useMemo(
    () => createOrganizationEventListener(runtime.socket),
    [runtime.socket],
  );
  if (name === 'OrganizationKeyVault') return runtime.vault as T;
  return organizationEventListener as T;
}

export function useAuthenticatedCookieSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('ImporterApiProvider is missing');
  return {
    ...value,
    isAuthenticated:
      value.status === 'AUTHENTICATED' || (value.status === 'CONFIRMING' && Boolean(value.session)),
  };
}

function parseSessionDescriptor(value: unknown): AuthSessionDescriptor | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.sessionFamilyId !== 'string' ||
    typeof record.userId !== 'string' ||
    typeof record.expiresAt !== 'string' ||
    new Date(record.expiresAt).getTime() <= Date.now()
  )
    return null;
  return {
    sessionFamilyId: record.sessionFamilyId,
    userId: record.userId,
    expiresAt: record.expiresAt,
  };
}

function createOrganizationEventListener(socket: BusinessSocketLike): OrganizationEventListener {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    subscribe(params) {
      const handler = (data: unknown) => params.handlers.onUpdated?.(data);
      handlers.set(params.subscriptionKey, handler);
      socket.on(params.eventName, handler);
      socket.emit(ORGANIZATION_SOCKET_COMMANDS.SUBSCRIBE_TENANT, {
        tenantId: params.organizationId,
      });
    },
    unsubscribe(params) {
      const handler = handlers.get(params.subscriptionKey);
      if (handler) socket.off(params.eventName, handler);
      handlers.delete(params.subscriptionKey);
      socket.emit(ORGANIZATION_SOCKET_COMMANDS.UNSUBSCRIBE_TENANT, {
        tenantId: params.organizationId,
      });
    },
  };
}
