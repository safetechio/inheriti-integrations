import { createHash } from 'node:crypto';
import { createQuickPlanOperations } from '@safetech/inheriti-elements-core/node';
import type { QuickPlanInput } from '@safetech/inheriti-elements-core/node';
import { creationErrorMessage } from './creation-error.js';
import { trayMessages as messages } from '../../../messages.js';

type Operations = ReturnType<typeof createQuickPlanOperations>;
type CreationPhase = 'creating_plan' | 'encrypting' | 'generating_shares' | 'preflighting' | 'distributing' | 'configuring' | 'verifying';
export type CreationState = { status: 'preparing-key' | 'awaiting-key' | 'securing' | 'ready' | 'error'; phase?: CreationPhase; message?: string; planId?: string; teamId?: string };
type CreateContext = Awaited<ReturnType<Operations['createContext']>>;

export class TrayQuickPlans {
  private organizationId: string | undefined;
  private operations: Operations | undefined;
  private context: CreateContext | undefined;
  private inputFingerprint: string | undefined;
  private pending: Promise<void> | undefined;
  private clearReadyOnCompletion = false;
  private creation: CreationState | undefined;
  private keyRequest: AbortController | undefined;
  private masterKeySource: { resolve: () => Promise<string> } | undefined;
  private phase: CreationPhase | undefined;
  private teams: { id: string; name: string }[] = [];
  private message: string | undefined;
  private selectionVersion = 0;

  constructor(
    private readonly apiUrl: string,
    private readonly environment: 'TEST' | 'LIVE',
    private readonly getAccessToken: () => Promise<string | undefined>,
    private readonly acquireKey?: (organizationId: string, signal: AbortSignal, onRelaySession: () => void) => Promise<string>,
  ) {}

  state(): { teams: { id: string; name: string }[]; creation?: CreationState; message?: string } {
    return {
      teams: this.teams.map(({ id, name }) => ({ id, name })),
      ...(this.creation ? { creation: this.creation } : {}),
      ...(this.message ? { message: this.message } : {}),
    };
  }

  assertIdle(): void {
    if (this.pending) throw new Error('creation_in_progress');
  }

  assertCanSelectOrganization(id: string): void {
    this.assertIdle();
    if (this.organizationId !== id && this.context) throw new Error('creation_abandon_required');
  }

  async selectOrganization(id: string): Promise<void> {
    this.assertCanSelectOrganization(id);
    if (this.organizationId !== id) {
      this.clear();
      this.organizationId = id;
    }
    await this.loadTeams(++this.selectionVersion);
  }

  async create(input: { title: string; asset: QuickPlanInput['asset']; teamId?: string }, onChange: () => void): Promise<void> {
    this.assertIdle();
    if (!this.organizationId) throw new Error('organization_required');
    if (input.teamId && !this.teams.some(({ id }) => id === input.teamId)) throw new Error(messages.teamUnavailable);
    if (this.creation?.status === 'ready') this.clearAttempt();
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    if (this.inputFingerprint && this.inputFingerprint !== fingerprint) throw new Error(messages.creationInputChanged);
    this.inputFingerprint = fingerprint;
    const pending = this.runCreate(input, onChange);
    this.pending = pending;
    try {
      await pending;
    } finally {
      this.pending = undefined;
    }
  }

  abandon(): void {
    this.assertIdle();
    if (this.context) this.operations?.abandon(this.context.planId);
    this.clearAttempt();
  }

  cancelKeyRequest(): void {
    if (!this.keyRequest) throw new Error('key_request_not_cancelable');
    this.keyRequest.abort();
  }

  clear(): void {
    this.assertIdle();
    this.selectionVersion += 1;
    this.clearAttempt();
    this.operations = undefined;
    this.organizationId = undefined;
    this.teams = [];
    this.message = undefined;
  }

  clearResolved(): void {
    if (this.pending) {
      this.clearReadyOnCompletion = true;
      return;
    }
    if (this.creation?.status === 'ready') this.clearAttempt();
  }

  private clearAttempt(): void {
    this.creation = undefined;
    this.context = undefined;
    this.inputFingerprint = undefined;
    this.masterKeySource = undefined;
    this.phase = undefined;
  }

  private async runCreate(input: { title: string; asset: QuickPlanInput['asset']; teamId?: string }, onChange: () => void): Promise<void> {
    const operations = this.selectedOperations();
    this.creation = { status: 'preparing-key', ...(this.context ? { planId: this.context.planId } : {}) };
    onChange();
    try {
      if (!this.masterKeySource) {
        const request = new AbortController();
        this.keyRequest = request;
        const key = await operations.acquireKey(request.signal, () => {
          this.creation = { status: 'awaiting-key' };
          onChange();
        });
        if (request.signal.aborted) throw new DOMException('The operation was aborted', 'AbortError');
        if (!key) throw new Error('master_key_not_claimed');
        this.masterKeySource = { resolve: async () => key };
        this.keyRequest = undefined;
      }
      this.creation = { status: 'securing', ...(this.context ? { planId: this.context.planId } : {}), ...(this.phase ? { phase: this.phase } : {}) };
      onChange();
      this.context ??= await operations.createContext();
      this.creation = { status: 'securing', planId: this.context.planId, ...(this.phase ? { phase: this.phase } : {}) };
      onChange();
      const result = await operations.create({ context: this.context, title: input.title, asset: input.asset, masterKeySource: this.masterKeySource, ...(input.teamId ? { teamId: input.teamId } : {}) }, (phase: CreationPhase) => {
        this.phase = phase;
        this.creation = { status: 'securing', planId: this.context!.planId, phase };
        onChange();
      });
      this.creation = result.status === 'READY'
        ? { status: 'ready', planId: result.planId, ...(input.teamId ? { teamId: input.teamId } : {}) }
        : { status: 'error', planId: result.planId, message: messages.protectionPending };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError' && !this.context) {
        this.clearAttempt();
      } else {
        this.creation = { status: 'error', ...(this.context ? { planId: this.context.planId } : {}), ...(this.phase ? { phase: this.phase } : {}), message: creationErrorMessage(error) };
        if (!this.context) this.inputFingerprint = undefined;
      }
    }
    this.keyRequest = undefined;
    if (this.clearReadyOnCompletion && this.creation?.status === 'ready') this.clearAttempt();
    this.clearReadyOnCompletion = false;
    onChange();
  }

  private selectedOperations(): Operations {
    if (!this.organizationId) throw new Error('organization_required');
    this.operations ??= createQuickPlanOperations({
      apiUrl: this.apiUrl, environment: this.environment, organizationId: this.organizationId,
      getBearerToken: this.getAccessToken,
      ...(this.acquireKey ? { acquireKey: (signal: AbortSignal, onRelaySession: () => void) => this.acquireKey!(this.organizationId!, signal, onRelaySession) } : {}),
    });
    return this.operations;
  }

  private async loadTeams(version: number): Promise<void> {
    const operations = this.selectedOperations();
    try {
      const teams = (await operations.teams()).teams;
      if (version !== this.selectionVersion) return;
      this.teams = teams;
      this.message = undefined;
    } catch {
      if (version !== this.selectionVersion) return;
      this.teams = [];
      this.message = messages.teamsUnavailable;
    }
  }
}
