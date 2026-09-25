export type CustodianPromptState =
  | { kind: 'choice'; proAvailable: boolean }
  | { kind: 'connect' | 'working'; firstAccess: boolean }
  | { kind: 'pin'; firstAccess: boolean; invalidPin: boolean }
  | { kind: 'touch'; firstAccess: boolean; operation: 'login' | 'read' | 'write'; attempt: number; limit: number };

type Pending<T> = { resolve: (value: T) => void; reject: (reason: Error) => void; signal: AbortSignal | undefined; abort: () => void };

export class CustodianPrompt {
  private current: CustodianPromptState | undefined;
  private choice: Pending<'SK_MOBILE' | 'SK_PRO'> | undefined;
  private pin: Pending<Uint8Array> | undefined;
  private publish: () => void = () => {};

  setPublisher(publish: () => void): void { this.publish = publish; }
  state(): CustodianPromptState | undefined { return this.current; }

  choose(proAvailable: boolean, signal?: AbortSignal): Promise<'SK_MOBILE' | 'SK_PRO'> {
    if (signal?.aborted || this.choice || this.pin) return Promise.reject(new Error('custodian_prompt_unavailable'));
    return new Promise((resolve, reject) => {
      const abort = () => this.cancel();
      this.choice = { resolve, reject, signal, abort };
      signal?.addEventListener('abort', abort, { once: true });
      this.show({ kind: 'choice', proAvailable });
    });
  }

  readPin(firstAccess: boolean, signal?: AbortSignal, invalidPin = false): Promise<Uint8Array> {
    if (signal?.aborted || this.choice || this.pin) return Promise.reject(new Error('custodian_prompt_unavailable'));
    return new Promise((resolve, reject) => {
      const abort = () => this.cancel();
      this.pin = { resolve, reject, signal, abort };
      signal?.addEventListener('abort', abort, { once: true });
      this.show({ kind: 'pin', firstAccess, invalidPin });
    });
  }

  connect(firstAccess: boolean): void { this.show({ kind: 'connect', firstAccess }); }
  working(firstAccess: boolean): void { this.show({ kind: 'working', firstAccess }); }
  touch(firstAccess: boolean, operation: 'login' | 'read' | 'write', attempt: number, limit: number): void {
    this.show({ kind: 'touch', firstAccess, operation, attempt, limit });
  }

  select(value: unknown): void {
    if (!this.choice || this.current?.kind !== 'choice' || (value !== 'SK_MOBILE' && value !== 'SK_PRO')) throw new Error('invalid_custodian_choice');
    if (value === 'SK_PRO' && !this.current.proAvailable) throw new Error('safekey_pro_unavailable');
    const pending = this.choice;
    this.finish('choice');
    this.show(value === 'SK_PRO' ? { kind: 'connect', firstAccess: true } : undefined);
    pending.resolve(value);
  }

  submitPin(value: unknown): void {
    if (!this.pin || this.current?.kind !== 'pin' || typeof value !== 'string' || !value || value.length > 128 || !/^[\x20-\x7e]+$/.test(value)) throw new Error('invalid_safekey_pin');
    const pending = this.pin;
    const firstAccess = this.current.firstAccess;
    this.finish('pin');
    this.working(firstAccess);
    pending.resolve(new TextEncoder().encode(value));
  }

  cancel(): void {
    this.choice?.reject(new Error('custodian_prompt_canceled'));
    this.pin?.reject(new Error('custodian_prompt_canceled'));
    this.finish('choice');
    this.finish('pin');
    this.show(undefined);
  }

  clear(): void { this.show(undefined); }

  private finish(kind: 'choice' | 'pin'): void {
    const pending = kind === 'choice' ? this.choice : this.pin;
    pending?.signal?.removeEventListener('abort', pending.abort);
    if (kind === 'choice') this.choice = undefined;
    else this.pin = undefined;
  }

  private show(state: CustodianPromptState | undefined): void {
    this.current = state;
    this.publish();
  }
}
