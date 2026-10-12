import { describe, expect, it } from 'vitest';
import {
  assertPlanBatchPreflight,
  type BatchPreflightContext,
} from '@modules/batch/application/batch-preflight';
import { buildPlanBatchInput } from '@modules/batch/application/batch-payload';
import { makePlanDraft, type PlanDraft } from '@modules/plans/domain/workspace-model';
import {
  SensitiveValue,
  createEmptyImportSession,
  type ImportSession,
} from '@modules/import/domain/import-model';

/**
 * `assertPlanBatchPreflight` is the single gate the batch executor calls
 * before any write happens for a Plan (`use-plan-batch-controller.ts`'s
 * `validate` callback). This suite exercises every distinct way it can
 * reject a Plan, one at a time, so a regression in any single check fails
 * here rather than surfacing as an opaque batch failure later.
 */

function session(): ImportSession {
  return createEmptyImportSession('session-1');
}

function draftWithAsset(clientId = 'plan-1'): PlanDraft {
  const plan = makePlanDraft(clientId, 'Imported Plan');
  plan.assets = [
    {
      id: `${clientId}-asset-1`,
      type: 'PLAIN-TEXT',
      name: 'Secret',
      fieldBindings: { 'secret.text': { kind: 'literal', value: new SensitiveValue('s3cr3t') } },
    },
  ];
  return plan;
}

function baseContext(overrides: Partial<BatchPreflightContext> = {}): BatchPreflightContext {
  return {
    organizationId: 'org-1',
    ...overrides,
  };
}

function inputFor(plan: PlanDraft) {
  return buildPlanBatchInput({
    plan,
    session: session(),
    organizationId: 'org-1',
    creatorMemberId: 'member-1',
    totalShares: 1,
  });
}

describe('assertPlanBatchPreflight', () => {
  it('passes a fully valid Plan against a permissive organization', () => {
    expect(() =>
      assertPlanBatchPreflight(inputFor(draftWithAsset()), session(), baseContext()),
    ).not.toThrow();
  });

  it('rejects when no organization is selected', () => {
    expect(() =>
      assertPlanBatchPreflight(
        inputFor(draftWithAsset()),
        session(),
        baseContext({ organizationId: undefined }),
      ),
    ).toThrow(/no organization/i);
  });

  it('rejects a stale source-field binding via the same materialisation gate the mapping UI uses', () => {
    const plan = draftWithAsset();
    plan.assets[0]!.fieldBindings = {
      'secret.text': { kind: 'source', sourceFieldId: 'does-not-exist' },
    };
    expect(() => assertPlanBatchPreflight(inputFor(plan), session(), baseContext())).toThrow();
  });

  it('allows incomplete final Plan governance during staging', () => {
    const plan = draftWithAsset();
    plan.governance.moderatedAccess = false;
    plan.governance.authenticationMethodIds = [];
    plan.governance.sharingModel = 'PRIVATE';
    plan.teamIds = ['team-not-yet-resolved'];
    plan.categoryId = 'category-to-be-resolved-in-business';
    expect(() => assertPlanBatchPreflight(inputFor(plan), session(), baseContext())).not.toThrow();
  });

  it('does not require an active Plan storage layer to stage a draft', () => {
    expect(() =>
      assertPlanBatchPreflight(inputFor(draftWithAsset()), session(), baseContext()),
    ).not.toThrow();
  });
});
