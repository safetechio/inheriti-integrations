import { describe, expect, it } from 'vitest';
import { planDraftView } from '@modules/plans/domain/workspace-selectors';
import { makePlanDraft } from '@modules/plans/domain/workspace-model';

describe('planDraftView', () => {
  it('marks a newly created empty Plan invalid', () => {
    const view = planDraftView(makePlanDraft('plan-1', 'Imported Plan'));

    expect(view.status).toBe('INVALID');
    expect(view.issues.map((issue) => issue.code)).toEqual(['NO_ASSETS']);
  });

  it('marks an Asset without bindings incomplete', () => {
    const plan = makePlanDraft('plan-1', 'Imported Plan');
    plan.assets.push({ id: 'asset-1', type: 'PLAIN-TEXT', name: 'Notes', fieldBindings: {} });

    const view = planDraftView(plan);

    expect(view.issues).toEqual([
      {
        code: 'ASSET_INCOMPLETE',
        message: 'Notes has no mapped or literal fields.',
        assetId: 'asset-1',
      },
    ]);
  });
});
