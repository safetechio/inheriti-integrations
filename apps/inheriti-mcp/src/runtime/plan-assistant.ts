import { createHash } from 'node:crypto';
import {
  createNativeWindowSession,
  createQuickPlanOperations,
  runLocalPlanBrowser,
  LlamaPlanModel,
} from '@safetech/inheriti-elements-core/node-base';
import type { LocalPlanHints } from '@safetech/inheriti-elements-core/node-base';
import { ensureLocalAssistant } from '../plan-assistant.js';
import type { MetadataTools } from '../server.js';
import { coded } from './errors.js';

export async function createPlanWithAssistant(this: MetadataTools, hints?: LocalPlanHints) {
  const version = this.selectionVersion;
  const selected = await this.selected();
  if (!('organizationId' in selected)) return selected;
  if (version !== this.selectionVersion) throw coded('organization_selection_changed');
  if (this.planJob?.status === 'WAITING') throw coded('plan_creation_in_progress');
  const controller = new AbortController();
  const windowState = { unavailable: false };
  const window = createNativeWindowSession((reason) => {
    windowState.unavailable = reason === 'unavailable';
    controller.abort();
  });
  const job: NonNullable<typeof this.planJob> = {
    id: crypto.randomUUID(),
    status: 'WAITING',
    phase: 'SETUP',
    controller,
    done: Promise.resolve(),
  };
  this.planJob = job;
  job.done = (async () => {
    const installed = await ensureLocalAssistant(controller.signal, (url) => window.open(url));
    if (controller.signal.aborted || version !== this.selectionVersion) throw coded('local_plan_canceled');
    const model = new LlamaPlanModel(installed.executablePath, installed.modelPath);
    const operations = createQuickPlanOperations({
      apiUrl: this.config!.apiUrl,
      environment: this.config!.environment,
      organizationId: selected.organizationId,
      getBearerToken: () => selected.core.getAccessToken(),
    });
    const state: {
      masterKeySource?: { resolve: () => Promise<string> };
      planContext?: Awaited<ReturnType<typeof operations.createContext>>;
      inputFingerprint?: string;
      creationFlight?: ReturnType<typeof operations.createMany>;
    } = {};
    const teams = (await operations.teams()).teams;
    if (controller.signal.aborted || version !== this.selectionVersion) throw coded('local_plan_canceled');
    job.phase = 'WINDOW';
    try {
      await runLocalPlanBrowser({
        model,
        signal: controller.signal,
        teams,
        ...(hints ? { hints } : {}),
        fontFile: new URL(
          import.meta.url.endsWith('/main.js') ? './assets/font-app.ttf' : '../assets/font-app.ttf',
          import.meta.url,
        ),
        open: (url) => window.open(url),
        create: async (input) => {
          if (controller.signal.aborted || version !== this.selectionVersion) throw coded('local_plan_canceled');
          const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
          if (state.inputFingerprint && state.inputFingerprint !== fingerprint)
            throw coded('plan_creation_input_changed');
          state.inputFingerprint = fingerprint;
          if (!state.masterKeySource) {
            job.phase = 'ACQUIRING_KEY';
            const key = await operations.acquireKey(controller.signal, () => {
              job.phase = 'AWAITING_KEY';
            });
            if (!key) throw coded('master_key_required');
            state.masterKeySource = { resolve: async () => key };
          }
          if (controller.signal.aborted || version !== this.selectionVersion) throw coded('local_plan_canceled');
          job.phase = 'CREATING';
          state.planContext ??= await operations.createContext();
          if (controller.signal.aborted || version !== this.selectionVersion) {
            await operations.abandon(state.planContext.planId);
            throw coded('local_plan_canceled');
          }
          job.planId = state.planContext.planId;
          state.creationFlight = operations.createMany({
            context: state.planContext,
            ...input,
            masterKeySource: state.masterKeySource!,
          });
          const created = await state.creationFlight;
          job.status = created.status === 'READY' ? 'CREATED' : 'PENDING';
          return created;
        },
      });
    } catch (error) {
      if (state.creationFlight) await state.creationFlight.catch(() => undefined);
      if (job.status === 'WAITING') throw error;
    } finally {
      model.stop();
    }
    if (job.status === 'WAITING') job.status = 'CREATED';
    job.phase = 'COMPLETE';
  })()
    .catch(() => {
      job.status = windowState.unavailable
        ? 'FAILED'
        : controller.signal.aborted && !job.planId
          ? 'CANCELED'
          : 'FAILED';
      job.phase = windowState.unavailable ? 'WINDOW_UNAVAILABLE' : job.status;
    })
    .finally(() => {
      if (job.status === 'CREATED' || job.status === 'PENDING') {
        window.complete();
        return;
      }
      window.close();
    });
  return { jobId: job.id, status: job.status };
}
export async function planCreationStatus(this: MetadataTools, jobId: string, cancel = false) {
  const job = this.planJob;
  if (!job || job.id !== jobId) throw coded('plan_creation_not_found');
  if (cancel && job.status === 'WAITING') {
    job.controller.abort();
    await job.done;
  }
  return { jobId: job.id, status: job.status, phase: job.phase, ...(job.planId ? { planId: job.planId } : {}) };
}
