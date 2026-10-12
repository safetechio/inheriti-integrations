import { useCallback, useEffect, useRef, useState } from 'react';
import {
  computePassphraseVerifier,
  decryptRSAOAEP,
  deriveMasterKey,
  encryptRSAOAEP,
} from '@safetech/inheriti-core-sdk/core';
import {
  useService,
  type OrganizationEventListener,
  type OrganizationKeyVault,
} from '@shared/infrastructure/importer-api';
import {
  useGetMasterKeySeed,
  useMasterKeySession,
  useVerifyMasterKeyPassphrase,
  type MasterKeySessionStep,
} from '@modules/organization/infrastructure/importer-api';
import type { OrganizationKeyIdentity } from '../domain/plan-batch-input';

/**
 * Organization Key acquisition scoped to the active organization and login
 * session. A locally available key bypasses the SafeKey Mobile relay.
 */
export interface OrganizationKeyReleaseState {
  activePlanId: string | null;
  step: MasterKeySessionStep | 'idle';
  error: string | null;
  localKeyAvailable: boolean | undefined;
  canSimulateLocally: boolean;
}

export interface OrganizationKeyRelease {
  state: OrganizationKeyReleaseState;
  acquire: (planId?: string) => Promise<string>;
  /** Cancels the active relay acquisition and rejects its pending acquisition. */
  cancel: () => void;
  simulateLocalRelease: (recoveryCode: string) => Promise<void>;
}

type Pending = { resolve: (key: string) => void; reject: (error: Error) => void };
const ORGANIZATION_KEY_REQUEST_ID = 'organization-key-request';

export function useOrganizationKeyRelease({
  organizationId,
  identity,
  vault,
}: {
  organizationId: string | undefined;
  identity: OrganizationKeyIdentity | null;
  vault: OrganizationKeyVault;
}): OrganizationKeyRelease {
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localKeyAvailable, setLocalKeyAvailable] = useState<boolean | undefined>();
  const pendingRef = useRef(new Map<string, Pending>());
  const currentAttemptStartedRef = useRef(false);

  useEffect(() => {
    setLocalKeyAvailable(undefined);
    if (!identity) return;
    let cancelled = false;
    void vault
      .get(identity)
      .then((key) => {
        if (!cancelled) setLocalKeyAvailable(Boolean(key));
      })
      .catch(() => {
        if (!cancelled) setLocalKeyAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [identity, vault]);

  const settle = useCallback((planId: string, outcome: { key: string } | { error: Error }) => {
    const pending = pendingRef.current.get(planId);
    pendingRef.current.delete(planId);
    setActivePlanId((current) => (current === planId ? null : current));
    if (!pending) return;
    if ('key' in outcome) {
      setError(null);
      pending.resolve(outcome.key);
    } else {
      setError(outcome.error.message);
      pending.reject(outcome.error);
    }
  }, []);

  const acquire = useCallback(
    async (planId?: string) => {
      if (identity) {
        const storedKey = await vault.get(identity).catch(() => null);
        if (storedKey) {
          setLocalKeyAvailable(true);
          setError(null);
          return storedKey;
        }
      }
      // The shared socket connects once and never re-reads the auth cookie on
      // its own reconnects, so it can sit "connected" but stale (built before
      // login, or after the cookie rotated) with no client-visible error — the
      // server-side room join silently never lands. Force a fresh,
      // guaranteed-authenticated handshake before every relay attempt rather
      // than trusting an existing connection to still be good.
      await window.inheriti?.socket?.reconnect().catch(() => {});
      return new Promise<string>((resolve, reject) => {
        const requestId = planId ?? ORGANIZATION_KEY_REQUEST_ID;
        setError(null);
        currentAttemptStartedRef.current = false;
        pendingRef.current.set(requestId, { resolve, reject });
        setActivePlanId(requestId);
      });
    },
    [identity, vault],
  );

  const { verify } = useVerifyMasterKeyPassphrase();
  const masterKeySeed = useGetMasterKeySeed(identity?.organizationId ?? organizationId, {
    enabled: import.meta.env.DEV && Boolean(activePlanId),
  });
  const verifyRef = useRef(verify);
  verifyRef.current = verify;

  const deliverMasterKey = useCallback(
    async (encryptedMasterKey: string, privateKey: CryptoKey) => {
      const planId = activePlanId;
      if (!planId || !identity) return;
      try {
        const masterKey = await decryptRSAOAEP(encryptedMasterKey, privateKey);
        const verifier = await computePassphraseVerifier(masterKey);
        if (!(await verifyRef.current({ orgId: identity.organizationId, verifier }))) {
          throw new Error('The delivered organization key could not be verified.');
        }
        await vault.set(identity, masterKey);
        setLocalKeyAvailable(true);
        settle(planId, { key: masterKey });
      } catch (caught) {
        settle(planId, {
          error:
            caught instanceof Error
              ? caught
              : new Error('The organization key could not be released.'),
        });
      }
    },
    [activePlanId, identity, settle, vault],
  );
  const deliverMasterKeyRef = useRef(deliverMasterKey);
  deliverMasterKeyRef.current = deliverMasterKey;

  const masterKeySession = useMasterKeySession({
    orgId: identity?.organizationId ?? organizationId ?? '',
    planId: activePlanId && activePlanId !== ORGANIZATION_KEY_REQUEST_ID ? activePlanId : undefined,
    enabled: !!activePlanId && !!identity,
    flow: 'CONFIGURATION',
    readStoredKey: () => {
      if (!identity || !activePlanId) return Promise.resolve(null);
      return vault.get(identity);
    },
    // Kept as a second, redundant delivery path: it targets the per-session
    // `master-key-session:<id>` socket room, which the Business API registers
    // a listener for but never actually publishes to (`MasterKeyDelivered`
    // only reaches the tenant-scoped `tenant_changed` broadcast below — see
    // the org-level listener effect). Left wired in case the backend gap is
    // closed later; it is a no-op until then.
    onDelivered: (encryptedMasterKey, privateKey) =>
      deliverMasterKeyRef.current(encryptedMasterKey, privateKey),
  });

  // The actual delivery path: the Business API forwards `MasterKeyDelivered`
  // through its generic tenant notification pipeline as a `tenant_changed`
  // event with `type: 'MASTER_KEY_DELIVERED'`, scoped to the organization
  // room rather than a session-specific one (mirrors Business UI's own
  // `useOrganizationGlobalListener` + `MasterKeySession` wiring).
  const organizationEventListener = useService<OrganizationEventListener>(
    'OrganizationEventListener',
  );
  useEffect(() => {
    if (!activePlanId || !identity) return;
    const sessionId = masterKeySession.sessionId;
    const privateKey = masterKeySession.privateKey;
    if (!sessionId || !privateKey) return;

    const orgId = identity.organizationId;
    const subscriptionKey = `organization-key-release-${sessionId}`;

    organizationEventListener.subscribe({
      organizationId: orgId,
      eventName: 'tenant_changed',
      subscriptionKey,
      handlers: {
        onUpdated: (data: unknown) => {
          const event = data as {
            type?: string;
            payload?: { sessionId?: string; encryptedMasterKey?: string };
          };
          if (event?.type !== 'MASTER_KEY_DELIVERED') return;
          if (!event.payload?.encryptedMasterKey || event.payload.sessionId !== sessionId) return;
          void deliverMasterKeyRef.current(event.payload.encryptedMasterKey, privateKey);
        },
      },
    });

    return () =>
      organizationEventListener.unsubscribe({
        organizationId: orgId,
        eventName: 'tenant_changed',
        subscriptionKey,
      });
  }, [
    activePlanId,
    identity,
    masterKeySession.sessionId,
    masterKeySession.privateKey,
    organizationEventListener,
  ]);

  const cancel = useCallback(() => {
    if (!activePlanId) return;
    settle(activePlanId, { error: new Error('Organization Key release was cancelled.') });
  }, [activePlanId, settle]);

  const simulateLocalRelease = useCallback(
    async (recoveryCode: string) => {
      if (!import.meta.env.DEV) throw new Error('Local release simulation is unavailable.');
      if (!identity || !activePlanId) throw new Error('Start a release request first.');
      if (
        masterKeySession.step !== 'ready' ||
        !masterKeySession.sessionId ||
        !masterKeySession.relayToken ||
        !masterKeySession.clientPublicKey
      ) {
        throw new Error('Wait until the Organization Key release request is ready.');
      }
      if (!masterKeySeed.data) {
        throw new Error('The Organization Key seed is unavailable for this account.');
      }
      if (!window.inheriti?.development) {
        throw new Error('Local release simulation requires the Electron app.');
      }

      const masterKey = await deriveMasterKey(recoveryCode, masterKeySeed.data);
      const verifier = await computePassphraseVerifier(masterKey);
      const valid = await verifyRef.current({ orgId: identity.organizationId, verifier });
      if (!valid) throw new Error('The Recovery code is incorrect.');

      const encryptedMasterKey = await encryptRSAOAEP(masterKey, masterKeySession.clientPublicKey);
      const response = await window.inheriti.development.deliverMasterKey({
        organizationId: identity.organizationId,
        sessionId: masterKeySession.sessionId,
        relayToken: masterKeySession.relayToken,
        encryptedMasterKey,
      });
      if (response.status >= 200 && response.status < 300) {
        await vault.set(identity, masterKey);
        setLocalKeyAvailable(true);
        settle(activePlanId, { key: masterKey });
        return;
      }

      const body = response.body as { message?: unknown; error?: unknown } | null;
      const message = body?.message ?? body?.error;
      throw new Error(typeof message === 'string' ? message : 'The simulated release failed.');
    },
    [activePlanId, identity, masterKeySeed.data, masterKeySession, settle, vault],
  );

  useEffect(() => {
    if (!activePlanId) return;
    if (masterKeySession.step === 'preparing' || masterKeySession.step === 'ready') {
      currentAttemptStartedRef.current = true;
      return;
    }
    if (!currentAttemptStartedRef.current) return;
    if (masterKeySession.step === 'available' && masterKeySession.availableMasterKey) {
      setLocalKeyAvailable(true);
      settle(activePlanId, { key: masterKeySession.availableMasterKey });
    } else if (masterKeySession.step === 'error') {
      settle(activePlanId, {
        error: new Error(masterKeySession.error ?? 'The organization key could not be released.'),
      });
    } else if (masterKeySession.step === 'not-claimed') {
      settle(activePlanId, {
        error: new Error('The Organization Key has not been claimed on a SafeKey device.'),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activePlanId,
    masterKeySession.step,
    masterKeySession.availableMasterKey,
    masterKeySession.error,
    settle,
  ]);

  return {
    state: {
      activePlanId,
      step: activePlanId ? masterKeySession.step : 'idle',
      error,
      localKeyAvailable,
      canSimulateLocally:
        import.meta.env.DEV &&
        masterKeySession.step === 'ready' &&
        Boolean(masterKeySeed.data) &&
        Boolean(window.inheriti?.development),
    },
    acquire,
    cancel,
    simulateLocalRelease,
  };
}
