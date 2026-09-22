import type { InteractionWorkflowPort, RevealWorkflowPort } from './index.js';

export interface SdkRevealWorkflow {
  startReveal(planId: string, input: { mode: 'DIRECT' | 'GOVERNED'; idempotencyKey: string }): Promise<{ id: string; stage: string }>;
  getReveal(revealId: string): Promise<{ id: string; stage: string }>;
  closeReveal(revealId: string, reason: 'COMPLETED' | 'CANCELED' | 'ERROR'): Promise<unknown>;
  authorizeRevealAction(revealId: string, input: {
    idempotencyKey: string;
    assetId: string;
    action: Parameters<InteractionWorkflowPort['authorize']>[0]['action'];
    fieldName?: string;
    destination?: Parameters<InteractionWorkflowPort['authorize']>[0]['context']['destination'];
    origin?: string;
  }): Promise<{ id: string }>;
  reportRevealActionOutcome(revealId: string, actionId: string, input: {
    idempotencyKey: string;
    outcome: 'SUCCEEDED' | 'CANCELED' | 'FAILED';
    reportedAt: string;
    errorCode?: string;
  }): Promise<unknown>;
}

/** Keep the published SDK vocabulary and wire shapes at the single composition seam. */
export function composeRevealWorkflows(client: SdkRevealWorkflow): {
  reveals: RevealWorkflowPort;
  interactions: InteractionWorkflowPort;
} {
  return {
    reveals: {
      start: async (planId, mode, idempotencyKey) => {
        const reveal = await client.startReveal(planId, { mode, idempotencyKey });
        return { revealId: reveal.id, status: reveal.stage };
      },
      status: async (revealId) => {
        const reveal = await client.getReveal(revealId);
        return { revealId: reveal.id, status: reveal.stage };
      },
      close: async (revealId, reason) => { await client.closeReveal(revealId, reason); },
    },
    interactions: {
      authorize: async ({ revealId, context, ...input }) => {
        const action = await client.authorizeRevealAction(revealId, {
          ...input,
          ...(context.destination === undefined ? {} : { destination: context.destination }),
          ...(context.origin === undefined ? {} : { origin: context.origin }),
        });
        return { id: action.id };
      },
      report: async ({ revealId, actionId, ...input }) => {
        await client.reportRevealActionOutcome(revealId, actionId, {
          ...input,
          reportedAt: new Date().toISOString(),
        });
      },
    },
  };
}
