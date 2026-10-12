import { useEffect, useRef, useState } from 'react';
import { generateRSAOAEPKeyPair } from '@safetech/inheriti-core-sdk/crypto';
import { request, useApiQuery } from '@shared/infrastructure/importer-api/http';
import { useRuntime } from '@shared/infrastructure/importer-api/runtime';

export function useGetMasterKeyConfigurationStatus(organizationId?: string) {
  const result = useApiQuery<{ configured?: boolean }>(
    ['master-key-status', organizationId],
    organizationId
      ? `/organizations/${encodeURIComponent(organizationId)}/master-key-configuration-status`
      : null,
  );
  return { ...result, data: Boolean(result.data?.configured) };
}

export function useGetMasterKeySeed(organizationId?: string, options?: { enabled?: boolean }) {
  const result = useApiQuery<{ seed?: string }>(
    ['master-key-seed', organizationId],
    organizationId && options?.enabled !== false
      ? `/organizations/${encodeURIComponent(organizationId)}/master-key-seed`
      : null,
  );
  return { ...result, data: result.data?.seed ?? null };
}

export function useVerifyMasterKeyPassphrase() {
  const { transport } = useRuntime();
  return {
    verify: async ({ orgId, verifier }: { orgId: string; verifier: string }) =>
      Boolean(
        (
          await request<{ valid?: boolean }>(
            transport,
            'POST',
            `/organizations/${encodeURIComponent(orgId)}/verify-passphrase`,
            { verifier },
          )
        )?.valid,
      ),
  };
}

export type MasterKeySessionStep = 'preparing' | 'ready' | 'available' | 'error' | 'not-claimed';

type MasterKeySessionState = {
  step: MasterKeySessionStep;
  availableMasterKey: string | null;
  sessionId: string | null;
  envelopeId: string | null;
  relayToken: string | null;
  clientPublicKey: string | null;
  privateKey: CryptoKey | null;
  error: string | null;
};

const initialState: MasterKeySessionState = {
  step: 'preparing',
  availableMasterKey: null,
  sessionId: null,
  envelopeId: null,
  relayToken: null,
  clientPublicKey: null,
  privateKey: null,
  error: null,
};

export function useMasterKeySession({
  orgId,
  enabled,
  planId,
  flow,
  readStoredKey,
}: {
  orgId: string;
  enabled: boolean;
  planId?: string;
  flow?: 'CONFIGURATION' | 'ACCESS';
  readStoredKey: () => Promise<string | null>;
  onDelivered?: (encryptedMasterKey: string, privateKey: CryptoKey) => void | Promise<void>;
}) {
  const { transport } = useRuntime();
  const readStoredKeyRef = useRef(readStoredKey);
  readStoredKeyRef.current = readStoredKey;
  const [state, setState] = useState<MasterKeySessionState>(initialState);
  useEffect(() => {
    if (!enabled || !orgId) return;
    let cancelled = false;
    let sessionId: string | null = null;
    setState(initialState);
    void (async () => {
      const stored = await readStoredKeyRef.current();
      if (stored) {
        if (!cancelled)
          setState((current) => ({
            ...current,
            step: 'available',
            availableMasterKey: stored,
          }));
        return;
      }
      const pair = await generateRSAOAEPKeyPair();
      const created = await request<{
        sessionId?: string;
        envelopeId?: string;
        relayToken?: string;
      }>(transport, 'POST', `/organizations/${encodeURIComponent(orgId)}/master-key-session`, {
        clientPublicKey: pair.publicKeyBase64,
        ...(planId && flow ? { planId, flow } : {}),
      });
      sessionId = created?.sessionId ?? null;
      if (!sessionId) throw new Error('Organization Key session was not created.');
      if (cancelled) {
        await cancelMasterKeySession(transport, orgId, sessionId);
        return;
      }
      setState({
        step: 'ready',
        availableMasterKey: null,
        sessionId,
        envelopeId: created.envelopeId ?? null,
        relayToken: created.relayToken ?? null,
        clientPublicKey: pair.publicKeyBase64,
        privateKey: pair.privateKey,
        error: null,
      });
    })().catch((caught) => {
      if (!cancelled)
        setState((current) => ({
          ...current,
          step: 'error',
          error: caught instanceof Error ? caught.message : 'Organization Key session failed.',
        }));
    });
    return () => {
      cancelled = true;
      if (sessionId) void cancelMasterKeySession(transport, orgId, sessionId);
    };
  }, [enabled, flow, orgId, planId, transport]);
  return state;
}

function cancelMasterKeySession(
  transport: ReturnType<typeof useRuntime>['transport'],
  orgId: string,
  sessionId: string,
) {
  return request(
    transport,
    'POST',
    `/organizations/${encodeURIComponent(orgId)}/master-key-session/${encodeURIComponent(sessionId)}/cancel`,
    {},
  );
}
