import type { RevealViewState } from '../../shared/messages.js';
import { DEADLINE_ALARM, RECOVERY_KEY } from './contracts.js';
import type { RevealRecovery, RevealSessionView } from './contracts.js';

export class RevealRecoveryStore {
  public intent: RevealRecovery | undefined;

  public constructor(private readonly storage: chrome.storage.StorageArea) {}

  public async read(): Promise<RevealRecovery | undefined> {
    const stored = await this.storage.get(RECOVERY_KEY);
    const recovery = stored[RECOVERY_KEY] as Partial<RevealRecovery> | undefined;
    if (typeof recovery?.planId !== 'string' || typeof recovery.deadline !== 'string') return undefined;
    if (recovery.intent?.kind !== 'FIELD' && recovery.intent?.kind !== 'BATCH') return undefined;
    return recovery as RevealRecovery;
  }

  public async rawRevealId(): Promise<string | undefined> {
    const stored = await this.storage.get(RECOVERY_KEY);
    const recovery = stored[RECOVERY_KEY] as { revealId?: unknown } | undefined;
    return typeof recovery?.revealId === 'string' ? recovery.revealId : undefined;
  }

  public async remember(session: Partial<Pick<RevealSessionView, 'id' | 'expiresAt'>>, state: RevealViewState): Promise<void> {
    if (this.intent === undefined) return;
    // Persist only intent and progress so a restarted worker can resume without storing plaintext.
    this.intent = {
      ...this.intent,
      ...(session.id === undefined ? {} : { revealId: session.id }),
      ...(session.expiresAt === undefined ? {} : { deadline: session.expiresAt }),
      ...(state.kind === 'RUNNING' ? { message: state.message } : {}),
    };
    await this.storage.set({ [RECOVERY_KEY]: this.intent });
    await chrome.alarms.create(DEADLINE_ALARM, { when: Date.parse(this.intent.deadline) });
  }

  public async forget(): Promise<void> {
    this.intent = undefined;
    await this.storage.remove(RECOVERY_KEY);
    await chrome.alarms.clear(DEADLINE_ALARM);
  }
}
