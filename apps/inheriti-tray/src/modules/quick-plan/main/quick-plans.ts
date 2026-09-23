import { createQuickPlanOperations } from '@safetech/inheriti-elements-core/node';
import type { QuickPlanInput } from '@safetech/inheriti-elements-core/node';
import { creationErrorMessage } from './creation-error.js';
import { trayMessages as messages } from '../../../messages.js';

export type CreationState = { status: 'securing' | 'ready' | 'error'; message?: string; planId?: string };
type Operations = ReturnType<typeof createQuickPlanOperations>;
type CreateContext = Awaited<ReturnType<Operations['createContext']>>;

export class TrayQuickPlans {
  private organizationId: string | undefined;
  private operations: Operations | undefined;
  private context: CreateContext | undefined;
  private inputFingerprint: string | undefined;
  private pending: Promise<void> | undefined;
  private creation: CreationState | undefined;
  private teams: { id: string; name: string }[] = [];
  private message: string | undefined;
  private selectionVersion = 0;

  constructor(
    private readonly apiUrl: string,
    private readonly environment: 'TEST' | 'LIVE',
    private readonly getAccessToken: () => Promise<string | undefined>,
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

  async selectOrganization(id: string): Promise<void> {
    this.assertIdle();
    if (this.organizationId !== id && this.context) throw new Error('creation_abandon_required');
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
    const fingerprint = JSON.stringify(input);
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

  clear(): void {
    this.assertIdle();
    this.selectionVersion += 1;
    this.creation = undefined;
    this.context = undefined;
    this.inputFingerprint = undefined;
    this.operations = undefined;
    this.organizationId = undefined;
    this.teams = [];
    this.message = undefined;
  }

  private clearAttempt(): void {
    this.creation = undefined;
    this.context = undefined;
    this.inputFingerprint = undefined;
  }

  private async runCreate(input: { title: string; asset: QuickPlanInput['asset']; teamId?: string }, onChange: () => void): Promise<void> {
    const operations = this.selectedOperations();
    this.creation = { status: 'securing', ...(this.context ? { planId: this.context.planId } : {}) };
    onChange();
    try {
      this.context ??= await operations.createContext();
      this.creation = { status: 'securing', planId: this.context.planId };
      onChange();
      const result = await operations.create({ context: this.context, title: input.title, asset: input.asset, ...(input.teamId ? { teamId: input.teamId } : {}) });
      this.creation = result.status === 'READY'
        ? { status: 'ready', planId: result.planId }
        : { status: 'error', planId: result.planId, message: messages.protectionPending };
    } catch (error) {
      this.creation = { status: 'error', ...(this.context ? { planId: this.context.planId } : {}), message: creationErrorMessage(error) };
    }
    onChange();
  }

  private selectedOperations(): Operations {
    if (!this.organizationId) throw new Error('organization_required');
    this.operations ??= createQuickPlanOperations({
      apiUrl: this.apiUrl, environment: this.environment, organizationId: this.organizationId,
      getBearerToken: this.getAccessToken,
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
