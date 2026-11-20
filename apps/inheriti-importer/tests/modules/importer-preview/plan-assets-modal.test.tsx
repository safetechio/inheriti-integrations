import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlanAssetsModal } from '@modules/importer-preview/PlanGroupingSurface/components/PlanAssetsModal';

afterEach(cleanup);

const plan = {
  id: 'draft', name: 'Payments', description: 'Imported', assets: 1,
  capacity: '1/10', valid: true, folderId: 'finance',
  assignedAssets: [{ id: 'asset', name: 'API key', type: 'USER-PSWD', folderPath: ['payments'] }],
};
const folders = [{ id: 'finance', name: 'Finance', parentId: null, scope: 'SHARED' as const, revision: 1 }];

describe('plan assets modal', () => {
  it('shows the draft, location, capacity and assets in a dialog', () => {
    render(<PlanAssetsModal plan={plan} folders={folders} onDismiss={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Payments' })).toBeTruthy();
    expect(screen.getByText('Location in your organisation: Finance')).toBeTruthy();
    expect(screen.getByText('1 of 10 Assets')).toBeTruthy();
    expect(screen.getByText('API key')).toBeTruthy();
    expect(screen.getByText('Username and Password')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('saves edited metadata and keeps removal wired to its plan', () => {
    const onSave = vi.fn();
    const onRemove = vi.fn();
    render(<PlanAssetsModal plan={plan} folders={folders} onDismiss={vi.fn()} onSave={onSave} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: /Remove .* from this plan/ }));
    expect(onRemove).toHaveBeenCalledWith(plan.assignedAssets[0], plan);
    fireEvent.change(screen.getByRole('textbox', { name: /Plan name/ }), { target: { value: 'Payments prod' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    expect(onSave).toHaveBeenCalledWith(plan, { name: 'Payments prod', description: 'Imported' });
  });

  it('closes with Escape', () => {
    const onDismiss = vi.fn();
    render(<PlanAssetsModal plan={plan} folders={folders} onDismiss={onDismiss} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
