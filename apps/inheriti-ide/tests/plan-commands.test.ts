import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handlers, showQuickPick, revealAndInsert } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  showQuickPick: vi.fn(async (items: Array<{ planId: string }>) => items[1]),
  revealAndInsert: vi.fn(async () => undefined),
}));

vi.mock('vscode', () => ({
  commands: { registerCommand: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => {
    handlers.set(name, handler);
    return { dispose() {} };
  } },
  window: { showQuickPick, showInformationMessage: vi.fn(async () => undefined), activeTextEditor: undefined },
}));
vi.mock('../src/reveal.js', () => ({ revealAndInsert }));

import { registerPlanCommands } from '../src/commands/plans.js';

describe('IDE plan commands', () => {
  beforeEach(() => { handlers.clear(); showQuickPick.mockClear(); revealAndInsert.mockClear(); });

  it('reveals the selected plan without asking for an id', async () => {
    const client = {
      getAccessToken: async () => 'token',
      listPlans: async () => ({ items: [
        { id: 'plan-1', name: 'First', status: 'ACTIVE' },
        { id: 'plan-2', name: 'Second', status: 'ACTIVE' },
      ], nextCursor: null }),
    };
    registerPlanCommands({
      currentCore: async () => client,
      revision: () => 1,
      keyOwner: () => 'Organisation',
      pickCustodianDevice: async () => 'SK_MOBILE',
      activeReveals: {},
      safeKeyPro: () => undefined,
    } as never);

    await handlers.get('inheriti.revealPlan')?.();

    expect(showQuickPick).toHaveBeenCalledOnce();
    expect(revealAndInsert).toHaveBeenCalledWith(client, expect.any(Object), expect.anything(), 'plan-2', 'Organisation', undefined);
  });
});
