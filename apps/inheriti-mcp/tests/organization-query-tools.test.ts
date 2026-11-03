import { expect, it, vi } from 'vitest';
import { MetadataTools } from '../src/server.js';
import { registerTools } from '../src/tools/index.js';

it('keeps the new read tools scoped to the selected organisation after switching', async () => {
  const tools = new MetadataTools() as any;
  const first = {
    listOrganizationMembers: vi.fn().mockResolvedValue({ items: [{ id: 'member-a' }], total: 1 }),
    listOrganizationAuditTrail: vi.fn().mockResolvedValue({ items: [], total: 0, nextCursor: null }),
    getOrganizationInsights: vi.fn().mockResolvedValue({ stats: { activeMembers: 1 } }),
    getPlanResponsibilities: vi.fn().mockResolvedValue({ planId: 'plan-a', participants: [] }),
  };
  const second = {
    listOrganizationMembers: vi.fn().mockResolvedValue({ items: [{ id: 'member-b' }], total: 1 }),
    listOrganizationAuditTrail: vi.fn().mockResolvedValue({ items: [], total: 0, nextCursor: null }),
    getOrganizationInsights: vi.fn().mockResolvedValue({ stats: { activeMembers: 2 } }),
    getPlanResponsibilities: vi.fn().mockResolvedValue({ planId: 'plan-b', participants: [] }),
  };
  let selected = { organizationId: 'org-a', core: first };
  tools.selected = async () => selected;
  const dates = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-31T23:59:59.999Z' };

  expect(await tools.listOrganizationMembers({ limit: 10 })).toMatchObject({ organizationId: 'org-a', items: [{ id: 'member-a' }] });
  expect(await tools.listOrganizationAuditTrail(dates)).toMatchObject({ organizationId: 'org-a', total: 0 });
  expect(await tools.getOrganizationInsights(dates)).toMatchObject({ organizationId: 'org-a', stats: { activeMembers: 1 } });
  expect(await tools.getPlanResponsibilities('plan-a')).toEqual({ organizationId: 'org-a', planId: 'plan-a', participants: [] });
  expect(first.listOrganizationMembers).toHaveBeenCalledWith({ limit: 10 });
  expect(first.listOrganizationAuditTrail).toHaveBeenCalledWith(dates);
  expect(first.getOrganizationInsights).toHaveBeenCalledWith(dates);
  expect(first.getPlanResponsibilities).toHaveBeenCalledWith('plan-a');

  selected = { organizationId: 'org-b', core: second };
  expect(await tools.listOrganizationMembers()).toMatchObject({ organizationId: 'org-b', items: [{ id: 'member-b' }] });
  expect(await tools.getPlanResponsibilities('plan-b')).toMatchObject({ organizationId: 'org-b', planId: 'plan-b' });
  expect(first.listOrganizationMembers).toHaveBeenCalledTimes(1);
  expect(second.listOrganizationMembers).toHaveBeenCalledWith({});
});

it('rejects caller supplied tenant scope and invalid dates before invoking tools', () => {
  const schemas = new Map<string, { safeParse: (input: unknown) => { success: boolean } }>();
  const server = { registerTool: (name: string, options: { inputSchema: { safeParse: (input: unknown) => { success: boolean } } }) => {
    schemas.set(name, options.inputSchema);
  } };
  registerTools(server as never, {} as never);
  const members = schemas.get('list_organization_members')!;
  const audit = schemas.get('list_organization_audit_trail')!;
  const insights = schemas.get('get_organization_insights')!;
  const responsibilities = schemas.get('get_plan_responsibilities')!;
  const plans = schemas.get('list_backup_plans')!;
  const dates = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-31T23:59:59.999Z' };
  for (const schema of [members, audit, insights, responsibilities, plans]) {
    expect(schema.safeParse({ ...dates, organizationId: 'foreign-org' }).success).toBe(false);
    expect(schema.safeParse({ ...dates, userId: 'other-user' }).success).toBe(false);
  }
  expect(audit.safeParse({ ...dates, memberId: 'not-a-uuid' }).success).toBe(false);
  expect(audit.safeParse({ ...dates, from: '2026-11-01T00:00:00.000Z' }).success).toBe(false);
  expect(insights.safeParse({ from: dates.from }).success).toBe(false);
  expect(members.safeParse({ limit: 101 }).success).toBe(false);
  expect(responsibilities.safeParse({ planId: 'not-a-uuid' }).success).toBe(false);
  expect(plans.safeParse({ status: ['PROTECTED'], namePrefix: 'Payroll', assetType: 'DOCUMENT' }).success).toBe(true);
});
