import type { NodeIntegrationCore } from '@safetech/inheriti-elements-core/node';
import type { PlanViewState } from './plan-view-model.js';
import { ExtensionConfigurationInvalid } from './configuration.js';

/**
 * The whole data path of the plans view, with no VS Code in it.
 *
 * Keeping it here means the states the tree can show are decided — and testable — without an editor,
 * and the tree adapter has nothing left to get wrong.
 */
export async function loadPlans(core: () => NodeIntegrationCore): Promise<PlanViewState> {
  let client: NodeIntegrationCore;
  try {
    client = core();
  } catch (error) {
    return { kind: 'ERROR', code: codeOf(error) };
  }
  if (!(await client.getAccessToken())) return { kind: 'SIGNED_OUT' };
  try {
    const page = await client.listPlans();
    return page.items.length === 0 ? { kind: 'EMPTY' } : { kind: 'PLANS', plans: page.items };
  } catch (error) {
    return { kind: 'ERROR', code: codeOf(error) };
  }
}

/**
 * Only our own stable codes reach the view. A runtime's own code is not one: `ERR_INVALID_URL` was
 * rendered to a real Extension Host before this guard existed, which told the operator nothing and
 * leaked an internal detail (D030).
 */
const STABLE_CODE = /^[a-z][a-z0-9_]{2,63}$/u;

export function codeOf(error: unknown): string {
  if (error instanceof ExtensionConfigurationInvalid) return error.code;
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && STABLE_CODE.test(code) ? code : 'plan_request_failed';
}
