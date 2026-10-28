import type { BrowserIntegrationCore } from '@safetech/inheriti-elements-core/browser';
import { RELAY_KEY } from './contracts.js';
import type { RelayOwner, RelayRecovery } from './contracts.js';
import { stableError } from './presentation.js';

export class RevealRelayStore {
  private relayWrite: Promise<void> = Promise.resolve();

  public constructor(
    private readonly getCore: () => Promise<BrowserIntegrationCore>,
    private readonly relayRecovery?: { storage: chrome.storage.StorageArea; owner(): Promise<RelayOwner | undefined> },
  ) {}

  public async ownedRelay(): Promise<RelayRecovery | undefined> {
    if (!this.relayRecovery) return undefined;
    const stored = (await this.relayRecovery.storage.get(RELAY_KEY))[RELAY_KEY] as RelayRecovery | undefined;
    if (!stored || typeof stored.sessionId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stored.sessionId)
      || typeof stored.expiresAt !== 'string') return undefined;
    if (Date.parse(stored.expiresAt) <= Date.now()) {
      await this.relayRecovery.storage.remove(RELAY_KEY);
      return undefined;
    }
    const owner = await this.relayRecovery.owner();
    return owner?.issuer === stored.issuer && owner.subject === stored.subject
      && owner.organizationId === stored.organizationId ? stored : undefined;
  }

  public async relay(planId: string): Promise<RelayRecovery | undefined> {
    const relay = await this.ownedRelay();
    return relay?.planId === planId ? relay : undefined;
  }

  public async rememberRelay(planId: string, session: { sessionId: string; expiresAt: string | Date },
    isCurrent: () => boolean): Promise<void> {
    if (!this.relayRecovery) return;
    const write = this.relayWrite.then(async () => {
      // A context switch must not persist a relay owned by the previous account.
      if (!isCurrent()) throw stableError('access-request-failed');
      const owner = await this.relayRecovery!.owner();
      if (!owner || !isCurrent()) throw stableError('access-request-failed');
      await this.relayRecovery!.storage.set({ [RELAY_KEY]: {
        ...owner, planId, sessionId: session.sessionId, expiresAt: new Date(session.expiresAt).toISOString(),
      } satisfies RelayRecovery });
    });
    this.relayWrite = write.then(() => undefined, () => undefined);
    await write;
  }

  public async cancelRelay(planId: string): Promise<void> {
    await this.relayWrite;
    const relay = await this.relay(planId);
    if (!relay) return;
    await (await this.getCore()).cancelMasterKeyRelaySession(relay.sessionId);
    await this.clearRelay(planId, relay.sessionId);
  }

  public async cancelOwnedRelay(): Promise<void> {
    const relay = await this.ownedRelay();
    if (relay) await this.cancelRelay(relay.planId);
  }

  public async clearRelay(planId: string, sessionId?: string): Promise<void> {
    if (!sessionId) return;
    await this.relayWrite;
    const relay = await this.relay(planId);
    if (relay?.sessionId === sessionId) await this.relayRecovery!.storage.remove(RELAY_KEY);
  }

}
