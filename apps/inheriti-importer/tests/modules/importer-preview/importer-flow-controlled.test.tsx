import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImporterFlow } from '@modules/importer-preview/ImporterFlow';
import type { ChecklistItem } from '@modules/importer-preview/FinalStagingChecklist';
import type { ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';
import type { GroupingAsset, PlanDraft } from '@modules/importer-preview/PlanGroupingSurface';
import type { ImportFile } from '@modules/importer-preview/SourceImportStatus';

afterEach(cleanup);

const file: ImportFile = {
  name: 'import.env',
  format: 'dotenv',
  entries: 1,
  warnings: 1,
  status: 'warning',
};
const asset: ReviewAsset = {
  id: 'asset-1',
  name: 'Credential',
  type: 'PLAIN-TEXT',
  status: 'accepted',
  confidence: 'High confidence',
  rationale: 'Mapped from source fields.',
  mapped: ['value'],
  unmapped: [],
  source: 'import.env',
  alternatives: [],
};
const plan: PlanDraft = {
  id: 'plan-1',
  name: 'Imported plan',
  assets: 1,
  capacity: '1 / 10 Assets',
  valid: true,
  assignedAssets: [],
};
const checklist: ChecklistItem[] = [
  { label: 'Imported sources reviewed', detail: 'Ready', complete: true },
  { label: 'Suggestions reviewed', detail: 'Ready', complete: true },
  { label: 'Plan assignment', detail: 'Ready', complete: true },
  { label: 'Organization Key', detail: 'Ready', complete: true },
  { label: 'Encryption', detail: 'Ready', complete: true },
];

function renderFlow(callbacks: Parameters<typeof ImporterFlow>[0]['callbacks']) {
  const unassigned: GroupingAsset[] = [];
  const plans: PlanDraft[] = [plan];
  return render(
    <ImporterFlow
      initialStage="sources"
      files={[file]}
      assets={[asset]}
      unassigned={unassigned}
      plans={plans}
      checklist={checklist}
      callbacks={callbacks}
    />,
  );
}

describe('ImporterFlow controlled mode', () => {
  it('preserves the selected row when a structured id changes to plain text', () => {
    const first = { ...asset, id: 'entry-1:API-KEY', name: 'First', type: 'API-KEY' };
    const second = { ...asset, id: 'entry-2:API-KEY', name: 'Second', type: 'API-KEY' };
    const { rerender } = render(
      <ImporterFlow
        initialStage="assets"
        files={[file]}
        assets={[first, second]}
        unassigned={[]}
        plans={[plan]}
        checklist={checklist}
        callbacks={{}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Inspect Second' }));
    rerender(
      <ImporterFlow
        initialStage="assets"
        files={[file]}
        assets={[first, { ...second, id: 'entry-2:PLAIN-TEXT', type: 'PLAIN-TEXT' }]}
        unassigned={[]}
        plans={[plan]}
        checklist={checklist}
        callbacks={{}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Accept as Plain Text' })).toBeTruthy();
  });

  it('confirms cancellation with the imported file and Plan counts', async () => {
    const onCancel = vi.fn();
    renderFlow({ onCancel });

    const opener = screen.getByRole('button', { name: 'Cancel import' });
    opener.focus();
    fireEvent.click(opener);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Cancel import?' })).toBeTruthy();
    expect(screen.getByText('1 imported file · 1 Plan will be removed.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep importing' }));
    await waitFor(() => expect(document.activeElement).toBe(opener));

    fireEvent.click(opener);
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel import' })[1]);

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('uses live controlled state when an incomplete stage becomes ready', () => {
    const unresolved = { ...asset, status: 'needs-review' as const };
    const { rerender } = render(
      <ImporterFlow
        initialStage="assets"
        files={[file]}
        assets={[unresolved]}
        unassigned={[]}
        plans={[plan]}
        checklist={checklist}
        callbacks={{}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Continue' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    rerender(
      <ImporterFlow
        initialStage="assets"
        files={[file]}
        assets={[asset]}
        unassigned={[]}
        plans={[plan]}
        checklist={checklist}
        callbacks={{}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Step 3 of 4')).toBeTruthy();
  });

  it('routes source actions to production callbacks without simulated state changes', () => {
    const onAddFiles = vi.fn();
    const onViewWarnings = vi.fn();
    renderFlow({ onAddFiles, onViewWarnings });

    fireEvent.click(screen.getByRole('button', { name: 'Add files' }));
    fireEvent.click(screen.getByRole('button', { name: /View warnings/i }));

    expect(onAddFiles).toHaveBeenCalledTimes(1);
    expect(onViewWarnings).toHaveBeenCalledWith(file);
  });

  it('requires a staging action and loaded Organization Key before enabling Encrypt and stage', () => {
    const { rerender } = renderFlow({});
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      screen.getByRole('button', { name: 'Encrypt and stage' }).getAttribute('aria-disabled'),
    ).toBe('true');

    const onStage = vi.fn();
    rerender(
      <ImporterFlow
        initialStage="staging"
        files={[file]}
        assets={[asset]}
        unassigned={[]}
        plans={[plan]}
        checklist={checklist}
        stagingState="waiting-release"
        callbacks={{ onStage }}
      />,
    );
    expect(
      (screen.getByRole('button', { name: 'Encrypt and stage' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Encrypt and stage' }));
    expect(onStage).not.toHaveBeenCalled();
    rerender(
      <ImporterFlow
        initialStage="staging"
        files={[file]}
        assets={[asset]}
        unassigned={[]}
        plans={[plan]}
        checklist={checklist}
        stagingState="configured"
        organizationKeyLoaded={false}
        callbacks={{ onStage }}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Encrypt and stage' }).getAttribute('aria-disabled'),
    ).toBe('true');
    rerender(
      <ImporterFlow
        initialStage="staging"
        files={[file]}
        assets={[asset]}
        unassigned={[]}
        plans={[plan]}
        checklist={checklist}
        stagingState="configured"
        organizationKeyLoaded={true}
        callbacks={{ onStage }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Encrypt and stage' }));
    expect(onStage).toHaveBeenCalledTimes(1);
  });

  it('routes edited plan metadata to the production callback', () => {
    const onUpdatePlan = vi.fn();
    render(
      <ImporterFlow
        initialStage="plans"
        files={[file]}
        assets={[asset]}
        unassigned={[]}
        plans={[plan]}
        checklist={checklist}
        callbacks={{ onUpdatePlan }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Imported plan' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Plan name' }), {
      target: { value: 'Imported production' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Plan description' }), {
      target: { value: 'Imported production access.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));

    expect(onUpdatePlan).toHaveBeenCalledWith(plan, {
      name: 'Imported production',
      description: 'Imported production access.',
    });
  });

  it('requests a SafeKey release and can cancel the controlled staging flow', () => {
    const onRequestOrganizationKey = vi.fn();
    const onCancelStage = vi.fn();
    const { rerender } = render(
      <ImporterFlow
        initialStage="staging"
        files={[file]}
        assets={[asset]}
        unassigned={[]}
        plans={[plan]}
        checklist={checklist}
        stagingState="waiting-release"
        callbacks={{ onRequestOrganizationKey, onCancelStage }}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Encrypt and stage' }).getAttribute('aria-disabled'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Request via SafeKey Mobile' }));
    expect(onRequestOrganizationKey).toHaveBeenCalledTimes(1);

    rerender(
      <ImporterFlow
        initialStage="staging"
        files={[file]}
        assets={[asset]}
        unassigned={[]}
        plans={[plan]}
        checklist={checklist}
        stagingState="releasing"
        callbacks={{ onCancelStage }}
      />,
    );
    expect(screen.getByText('Waiting for release from SafeKey Mobile.')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Organization Key in progress' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(onCancelStage).toHaveBeenCalledTimes(1);

    rerender(
      <ImporterFlow
        initialStage="staging"
        files={[file]}
        assets={[asset]}
        unassigned={[]}
        plans={[plan]}
        checklist={checklist}
        stagingState="waiting-release"
        organizationKeyError="The delivered Organization Key could not be verified."
        callbacks={{ onRequestOrganizationKey }}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe(
      'The delivered Organization Key could not be verified.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry release' }));
    expect(onRequestOrganizationKey).toHaveBeenCalledTimes(2);

    rerender(
      <ImporterFlow
        initialStage="staging"
        files={[file]}
        assets={[asset]}
        unassigned={[]}
        plans={[plan]}
        checklist={checklist}
        stagingState="waiting-release"
        organizationKeyError="master_key_not_claimed"
        callbacks={{ onRequestOrganizationKey }}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe(
      'The Organization Key has not been claimed yet. Claim it on your SafeKey device, then retry the release.',
    );

    const onStage = vi.fn();
    rerender(
      <ImporterFlow
        initialStage="staging"
        files={[file]}
        assets={[asset]}
        unassigned={[]}
        plans={[plan]}
        checklist={checklist}
        stagingState="configured"
        callbacks={{ onStage }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Request via SafeKey Mobile' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Encrypt and stage' }));
    expect(onStage).toHaveBeenCalledTimes(1);

    const onStartAgain = vi.fn();
    rerender(
      <ImporterFlow
        initialStage="staging"
        files={[file]}
        assets={[asset]}
        unassigned={[]}
        plans={[plan]}
        checklist={checklist}
        stagingState="staged"
        callbacks={{ onStartAgain }}
      />,
    );
    expect(screen.getByText('Import staged successfully')).toBeTruthy();
    expect(screen.getByText(/Your staged import expires in 7 days/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(onStartAgain).toHaveBeenCalledTimes(1);
    const continueLink = screen.getByRole('link', { name: 'Go to Inheriti Business' });
    expect(continueLink.getAttribute('href')).toBe(`${__WEB_APP_URL__}/organization/imports`);
    expect(continueLink.getAttribute('target')).toBe('_blank');
  });

  it('offers the local SafeKey simulator inside the active release state', async () => {
    const onSimulateOrganizationKeyRelease = vi.fn().mockResolvedValue(undefined);
    render(
      <ImporterFlow
        initialStage="staging"
        files={[file]}
        assets={[asset]}
        unassigned={[]}
        plans={[plan]}
        checklist={checklist}
        stagingState="releasing"
        canSimulateOrganizationKeyRelease
        callbacks={{ onSimulateOrganizationKeyRelease }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Simulate locally' }));
    expect(screen.getByRole('dialog', { name: 'Simulate SafeKey Mobile release' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Recovery code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Release locally' }));

    await waitFor(() => expect(onSimulateOrganizationKeyRelease).toHaveBeenCalledWith('123456'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Simulate SafeKey Mobile release' })).toBeNull(),
    );
  });

  it('keeps a loaded Organization Key ready while staging and after a staging failure', () => {
    const onStage = vi.fn();
    const onRetryStage = vi.fn();
    const { rerender } = render(
      <ImporterFlow
        initialStage="staging"
        files={[file]}
        assets={[asset]}
        unassigned={[]}
        plans={[plan]}
        checklist={checklist}
        stagingState="encrypting"
        organizationKeyLoaded
        callbacks={{ onStage }}
      />,
    );

    expect(
      screen.getByText('Organization Key loaded securely and ready for local encryption.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel request' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: /Import sources/ }) as HTMLButtonElement).disabled,
    ).toBe(true);

    rerender(
      <ImporterFlow
        initialStage="staging"
        files={[file]}
        assets={[asset]}
        unassigned={[]}
        plans={[plan]}
        checklist={checklist}
        stagingState="retry"
        organizationKeyLoaded
        callbacks={{ onStage, onRetryStage }}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Request via SafeKey Mobile' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('Some Plans were not staged');
    expect(screen.queryByRole('button', { name: 'Retry staging' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Encrypt and stage' })).toBeNull();
    expect(onRetryStage).not.toHaveBeenCalled();
    expect(onStage).not.toHaveBeenCalled();
  });
});
