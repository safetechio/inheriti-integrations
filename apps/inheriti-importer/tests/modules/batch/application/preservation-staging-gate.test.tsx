// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SensitiveValue, createEmptyImportSession } from '@modules/import/domain/import-model';
import { makePlanDraft } from '@modules/plans/domain/workspace-model';
import { freezeBatchSnapshot } from '@modules/batch/application/batch-snapshot';
import { buildPlanBatchInput } from '@modules/batch/application/batch-payload';
import { usePlanBatchStaging } from '@modules/batch/application/use-plan-batch-staging';
import type { OrganizationKeyRelease } from '@modules/batch/application/use-organization-key-release';
import type { ImporterToolRepo } from '@modules/batch/infrastructure/importer-tool-repo';

function setup() {
  const session = createEmptyImportSession('synthetic-gate');
  const plan = makePlanDraft('plan-1', 'Synthetic plan');
  plan.assets = [
    {
      id: 'asset-1',
      type: 'PLAIN-TEXT',
      name: 'Synthetic',
      fieldBindings: {
        'secret.text': { kind: 'literal', value: new SensitiveValue('SYNTHETIC_ONLY_gate') },
      },
    },
  ];
  const revision = Symbol();
  const [item] = freezeBatchSnapshot([
    {
      planId: plan.clientId,
      input: buildPlanBatchInput({
        plan,
        session,
        organizationId: 'org-1',
        totalShares: 1,
        preservationRevision: revision,
      }),
    },
  ]);
  let release!: (key: string) => void;
  const acquire = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  const repo = {
    isStaged: vi.fn(async () => false),
    stage: vi.fn<ImporterToolRepo['stage']>(async () => ({ id: 'staged', expiresAt: '' })),
  };
  const hook = renderHook(
    ({ ready, revision }) =>
      usePlanBatchStaging({
        session,
        organizationId: 'org-1',
        currentMemberId: 'member-1',
        keyRelease: { acquire } as unknown as OrganizationKeyRelease,
        importerToolRepo: repo as unknown as ImporterToolRepo,
        preservationReady: ready,
        preservationRevision: revision,
      }),
    { initialProps: { ready: true, revision } },
  );
  return { ...hook, item, repo, acquire, revision, releaseKey: () => release('0'.repeat(64)) };
}

describe('preservation staging boundary', () => {
  it('blocks an unresolved import before acquiring a key or writing', async () => {
    const view = setup();
    view.rerender({ ready: false, revision: view.revision });
    expect(() => view.result.current.validate({ input: view.item.input })).toThrow(
      /pending source fields/,
    );
    await expect(
      view.result.current.configure(view.item, new AbortController().signal),
    ).rejects.toThrow(/pending source fields/);
    expect(view.acquire).not.toHaveBeenCalled();
    expect(view.repo.stage).not.toHaveBeenCalled();
  });

  it('rechecks current coverage after waiting for the organization key', async () => {
    const view = setup();
    const configuring = view.result.current.configure(view.item, new AbortController().signal);
    view.rerender({ ready: false, revision: view.revision });
    view.releaseKey();
    await expect(configuring).rejects.toThrow(/pending source fields/);
    expect(view.repo.isStaged).not.toHaveBeenCalled();
    expect(view.repo.stage).not.toHaveBeenCalled();
  });
  it('rejects a stale frozen retry after the edited import becomes ready again', async () => {
    const view = setup();
    expect(view.item.input.preservationRevision).toBe(view.revision);
    const editedRevision = Symbol();
    view.rerender({ ready: false, revision: editedRevision });
    view.rerender({ ready: true, revision: editedRevision });
    expect(() => view.result.current.validate(view.item)).toThrow(/import changed/);
    await expect(
      view.result.current.configure(view.item, new AbortController().signal),
    ).rejects.toThrow(/import changed/);
    expect(view.acquire).not.toHaveBeenCalled();
    expect(view.repo.stage).not.toHaveBeenCalled();
  });

  it('checks the reviewed revision after awaiting the idempotency read', async () => {
    const view = setup();
    let answer!: (exists: boolean) => void;
    view.repo.isStaged.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    );
    const configuring = view.result.current.configure(view.item, new AbortController().signal);
    view.releaseKey();
    await Promise.resolve();
    view.rerender({ ready: true, revision: Symbol() });
    answer(true);
    await expect(configuring).rejects.toThrow(/import changed/);
    expect(view.repo.stage).not.toHaveBeenCalled();
  });

  it.each(['metadata', 'bound value'])(
    'rejects a previous receipt when submitted %s changes',
    async (change) => {
      const view = setup();
      view.repo.stage.mockImplementationOnce(async (_request, _signal, beforeWrite) => {
        beforeWrite?.();
        return { id: 'staged', expiresAt: '' };
      });
      const first = view.result.current.configure(view.item, new AbortController().signal);
      view.releaseKey();
      await first;
      expect(view.repo.stage).toHaveBeenCalledOnce();

      const editedRevision = Symbol();
      view.rerender({ ready: true, revision: editedRevision });
      view.repo.isStaged.mockResolvedValueOnce(true);
      const revised = {
        ...view.item,
        input: {
          ...view.item.input,
          preservationRevision: editedRevision,
          ...(change === 'metadata'
            ? { payload: { ...view.item.input.payload, name: 'Updated synthetic plan' } }
            : {
                assets: [
                  {
                    id: 'asset-1',
                    type: 'PLAIN-TEXT',
                    meta: { name: 'Synthetic' },
                    secret: { text: 'SYNTHETIC_CHANGED_BOUND_VALUE' },
                  },
                ],
              }),
        },
      };
      const configuring = view.result.current.configure(revised, new AbortController().signal);
      view.releaseKey();
      await expect(configuring).rejects.toThrow(/earlier revision/);
      expect(view.repo.stage).toHaveBeenCalledOnce();
    },
  );
});
