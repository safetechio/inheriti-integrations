export class TrayInboxAccess {
  private pending: { organizationId: string; requestId: number; controller: AbortController; promise: Promise<void> } | undefined;
  private validatedOrganization: string | undefined;

  constructor(private readonly context: () => { selectedId: string | undefined; selecting: boolean; signedIn: boolean },
    private readonly resolveKey: (organizationId: string, signal: AbortSignal) => Promise<unknown>) {}

  prepare(requestId: number): Promise<void> {
    const context = this.context();
    if (context.selecting || !context.signedIn || !context.selectedId) throw new Error('organization_required');
    const organizationId = context.selectedId;
    if (this.validatedOrganization === organizationId) return Promise.resolve();
    if (this.pending?.organizationId === organizationId && this.pending.requestId === requestId) return this.pending.promise;
    this.cancel();
    const controller = new AbortController();
    const promise = this.resolveKey(organizationId, controller.signal).then(() => {
      const current = this.context();
      if (controller.signal.aborted || current.selectedId !== organizationId || !current.signedIn) throw new Error('inbox_access_canceled');
      this.validatedOrganization = organizationId;
    }).finally(() => { if (this.pending?.controller === controller) this.pending = undefined; });
    this.pending = { organizationId, requestId, controller, promise };
    return promise;
  }

  cancel(requestId?: number): void {
    if (requestId !== undefined && this.pending?.requestId !== requestId) return;
    this.pending?.controller.abort();
    this.pending = undefined;
  }

  reset(): void {
    this.cancel();
    this.validatedOrganization = undefined;
  }
}
