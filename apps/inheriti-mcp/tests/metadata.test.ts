import { describe, expect, it } from 'vitest';
import { planDetail, planSummary } from '../src/metadata.js';
import { safeResult } from '../src/server.js';
import type { PlanDetail } from '@safetech/inheriti-elements-core/node';

const plan = {
  id: 'p1', name: 'My plan', status: 'ACTIVE', createdAt: '2026-01-01',
  assetSummary: { names: ['one'], secret: 'never expose' },
  assets: [{ id: 'a1', name: 'Asset', type: 'CREDENTIAL', isBinary: false, code: 'account', fieldNames: ['password'], secret: 'never expose' }],
  governance: { mode: 'DIRECT', minimumApprovals: 0 },
  description: 'Description', privateKey: 'never expose',
} as unknown as PlanDetail;

describe('model-facing metadata', () => {
  it('returns explicit plan fields only', () => {
    expect(planSummary(plan)).toEqual({ id: 'p1', name: 'My plan', status: 'ACTIVE', createdAt: '2026-01-01', assetCount: 1 });
    expect(planDetail(plan)).toEqual({ id: 'p1', name: 'My plan', status: 'ACTIVE', createdAt: '2026-01-01', assetCount: 1, description: 'Description', governanceMode: 'DIRECT', assets: [{ id: 'a1', name: 'Asset', type: 'CREDENTIAL', isBinary: false, code: 'account', fieldNames: ['password'] }] });
    expect(JSON.stringify(planDetail(plan))).not.toContain('never expose');
  });
  it('does not expose transport errors', async () => {
    const result = await safeResult(async () => { throw Object.assign(new Error('Bearer secret'), { code: 'Bearer secret' }); })({});
    expect(result).toMatchObject({ isError: true, content: [{ text: 'request_failed' }] });
  });
  it('preserves only the stable interrupted reveal code', async () => {
    const result = await safeResult(async () => { throw Object.assign(new Error('private diagnostic'), { code: 'reveal_restart_required' }); })({});
    expect(result).toMatchObject({ isError: true, content: [{ text: 'reveal_restart_required' }] });
    expect(JSON.stringify(result)).not.toContain('private diagnostic');
  });
  it('returns the governance code and safe repair instruction without transport details', async () => {
    const result = await safeResult(async () => { throw Object.assign(new Error('PLAN_GOVERNANCE_RECONFIGURATION_REQUIRED'), {
      details: { error: 'plan_governance_reconfiguration_required', description: 'private diagnostic' },
    }); })({});
    expect(result).toMatchObject({ isError: true,
      structuredContent: { code: 'plan_governance_reconfiguration_required', message: expect.stringContaining('Update Moderators in Inheriti Business plan settings') },
      content: [{ text: expect.stringContaining('plan_governance_reconfiguration_required: This plan needs more independent moderators') }],
    });
    expect(JSON.stringify(result)).toContain('Update Moderators in Inheriti Business plan settings');
    expect(JSON.stringify(result)).not.toContain('private diagnostic');
  });
  it.each(['automation_verified_release_unavailable', 'automation_active_grant_required', 'automation_verified_github_required', 'automation_github_workflow_ref_invalid'])('returns safe GitHub usage error %s', async (code) => {
    const result = await safeResult(async () => { throw Object.assign(new Error('private diagnostic'), { code }); })({});
    expect(result).toMatchObject({ isError: true, content: [{ text: code }] });
    expect(JSON.stringify(result)).not.toContain('private diagnostic');
  });
});
