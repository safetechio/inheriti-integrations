import { describe, expect, it } from 'vitest';
import { planDetail, planSummary } from '../src/metadata.js';
import { safeResult } from '../src/server.js';
import type { PlanDetail } from '@safetech/inheriti-elements-core/node';

const plan = {
  id: 'p1', name: 'My plan', status: 'ACTIVE', createdAt: '2026-01-01',
  assetSummary: { names: ['one'], secret: 'never expose' },
  assets: [{ id: 'a1', name: 'Asset', type: 'CREDENTIAL', isBinary: false, fieldNames: ['password'], secret: 'never expose' }],
  governance: { mode: 'DIRECT', minimumApprovals: 0 },
  description: 'Description', privateKey: 'never expose',
} as unknown as PlanDetail;

describe('model-facing metadata', () => {
  it('returns explicit plan fields only', () => {
    expect(planSummary(plan)).toEqual({ id: 'p1', name: 'My plan', status: 'ACTIVE', createdAt: '2026-01-01', assetCount: 1 });
    expect(planDetail(plan)).toEqual({ id: 'p1', name: 'My plan', status: 'ACTIVE', createdAt: '2026-01-01', assetCount: 1, description: 'Description', governanceMode: 'DIRECT', assets: [{ id: 'a1', name: 'Asset', type: 'CREDENTIAL', isBinary: false }] });
    expect(JSON.stringify(planDetail(plan))).not.toContain('never expose');
  });
  it('does not expose transport errors', async () => {
    const result = await safeResult(async () => { throw Object.assign(new Error('Bearer secret'), { code: 'Bearer secret' }); })({});
    expect(result).toMatchObject({ isError: true, content: [{ text: 'request_failed' }] });
  });
});
