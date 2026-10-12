// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const usePlanCreationOrgPolicy = vi.fn();
const useGetRawSelectedOrganizationId = vi.fn();
const useSelectedOrganizationMemberCapabilities = vi.fn();
const useSaveOrganizationPlanCategory = vi.fn();
const useFindActiveOrganizationPlanCategoriesByCriteria = vi.fn();
const useFindSelectedOrganizationPlanCreationTeamsByCriteria = vi.fn();

vi.mock('@modules/organization/infrastructure/importer-api', () => ({
  usePlanCreationOrgPolicy: (...args: unknown[]) => usePlanCreationOrgPolicy(...args),
  useGetRawSelectedOrganizationId: (...args: unknown[]) => useGetRawSelectedOrganizationId(...args),
  useSelectedOrganizationMemberCapabilities: (...args: unknown[]) =>
    useSelectedOrganizationMemberCapabilities(...args),
  useSaveOrganizationPlanCategory: (...args: unknown[]) => useSaveOrganizationPlanCategory(...args),
  useFindActiveOrganizationPlanCategoriesByCriteria: (...args: unknown[]) =>
    useFindActiveOrganizationPlanCategoriesByCriteria(...args),
  useFindSelectedOrganizationPlanCreationTeamsByCriteria: (...args: unknown[]) =>
    useFindSelectedOrganizationPlanCreationTeamsByCriteria(...args),
}));

import { PlanDetailsModal } from '@modules/plans/ui/components/PlanDetailsModal';
import { makePlanDraft, type PlanDraft } from '@modules/plans/domain/workspace-model';

function defaultPolicy() {
  return {
    privateAllowed: true,
    authRequired: false,
    moderationRequired: false,
    approvalModePerPlan: true,
    approvalMode: 'THRESHOLD' as const,
    organizationApprovalMode: 'PER_PLAN' as const,
    autoModeratorOwner: false,
    enabledMethods: {},
    authThreshold: 'per_plan' as const,
  };
}

function stubHooks(policyOverrides: Partial<ReturnType<typeof defaultPolicy>> = {}) {
  usePlanCreationOrgPolicy.mockReturnValue({ ...defaultPolicy(), ...policyOverrides });
  useGetRawSelectedOrganizationId.mockReturnValue({ data: 'org-1' });
  useSelectedOrganizationMemberCapabilities.mockReturnValue({ canCreatePlanCategories: false });
  useSaveOrganizationPlanCategory.mockReturnValue({ save: vi.fn(), loading: false });
  useFindActiveOrganizationPlanCategoriesByCriteria.mockReturnValue({ data: {} });
  useFindSelectedOrganizationPlanCreationTeamsByCriteria.mockReturnValue({ data: {} });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const draft: PlanDraft = makePlanDraft('plan-1', 'My Plan');

describe('PlanDetailsModal', () => {
  it('renders nothing when there is no Plan to edit', () => {
    stubHooks();
    const { container } = render(
      <PlanDetailsModal plan={null} onSave={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(container.textContent).toBe('');
  });

  it('walks Details -> Access -> Review and saves the entered values', async () => {
    stubHooks();
    const onSave = vi.fn();
    render(<PlanDetailsModal plan={draft} onSave={onSave} onDismiss={vi.fn()} />);

    expect(screen.getByText('Plan title')).toBeTruthy();
    expect(screen.getByText('Plan description')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Plan title'), { target: { value: 'Estate Plan' } });
    fireEvent.click(screen.getByRole('button', { name: '2. Access' }));
    fireEvent.click(screen.getByRole('button', { name: '3. Review' }));
    expect(screen.getByText('Estate Plan')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ name: 'Estate Plan', sharingModel: 'SHARED' });
  });

  it('blocks Next from Details when the title is empty', async () => {
    stubHooks();
    render(<PlanDetailsModal plan={{ ...draft, name: '' }} onSave={vi.fn()} onDismiss={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Plan title'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Title is required')).toBeTruthy());
  });

  it('disables Private sharing when the organization policy forbids it', () => {
    stubHooks({ privateAllowed: false });
    render(<PlanDetailsModal plan={draft} onSave={vi.fn()} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '2. Access' }));
    expect(screen.getByRole('button', { name: 'Private' })).toHaveProperty('disabled', true);
  });

  it('closes via the header close action, by mouse', () => {
    stubHooks();
    const onDismiss = vi.fn();
    render(<PlanDetailsModal plan={draft} onSave={vi.fn()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close plan details' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('closes via the header close action, by keyboard', () => {
    stubHooks();
    const onDismiss = vi.fn();
    render(<PlanDetailsModal plan={draft} onSave={vi.fn()} onDismiss={onDismiss} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close plan details' }), { key: 'Enter' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
