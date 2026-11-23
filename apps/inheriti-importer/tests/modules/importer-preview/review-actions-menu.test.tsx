import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReviewActionsMenu } from '@modules/importer-preview/AssetReviewQueue/components/ReviewActionsMenu';
import { AssetReviewQueue, type ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';
import type { FieldOperationControls } from '@modules/importer-preview/AssetReviewQueue/field-operations';

afterEach(cleanup);

it('supports keyboard navigation, skips unavailable actions and restores trigger focus on Escape', () => {
  const run = vi.fn();
  render(
    <ReviewActionsMenu
      label="Asset actions"
      items={[
        {
          label: 'Exclude from import',
          description: 'Skip this asset.',
          icon: 'ban',
          onSelect: run,
        },
        {
          label: 'Unavailable',
          description: 'Unavailable here.',
          icon: 'ban',
          disabled: true,
          onSelect: run,
        },
        {
          label: 'Remove draft asset',
          description: 'Return fields to Unassigned.',
          icon: 'trash-can',
          onSelect: run,
        },
      ]}
    />,
  );
  const trigger = screen.getByRole('button', { name: 'Asset actions' });
  fireEvent.click(trigger);
  const menu = screen.getByRole('menu', { name: 'Asset actions' });
  expect(document.activeElement).toBe(
    screen.getByRole('menuitem', { name: 'Exclude from import' }),
  );
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Remove draft asset' }));
  fireEvent.keyDown(menu, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(run).not.toHaveBeenCalled();
});

const draft: ReviewAsset = {
  id: 'generated',
  name: 'Created draft',
  type: 'PLAIN-TEXT',
  status: 'suggested',
  rationale: '',
  mapped: [],
  unmapped: [],
  source: 'source.json',
  sourceId: 'source',
  alternatives: [],
  canRemoveDraft: true,
};

it('keeps removal feedback and Undo reachable even when removal leaves no matching assets', () => {
  const remove = vi.fn();
  const undo = vi.fn();
  function Queue() {
    const [assets, setAssets] = useState([draft]);
    const [canUndo, setCanUndo] = useState(false);
    const fieldOperations: FieldOperationControls = {
      preview: vi.fn(),
      commit: vi.fn(),
      canUndo,
      remove(ids) {
        remove(ids);
        setAssets([]);
        setCanUndo(true);
        return {
          success: true,
          message: '1 draft removed · 2 fields returned to Unassigned.',
          createdAssetIds: [],
          changedAssetIds: [],
          removedAssetIds: ids,
        };
      },
      undo() {
        undo();
        setAssets([draft]);
        setCanUndo(false);
        return {
          success: true,
          message: 'Draft removal undone.',
          createdAssetIds: [],
          changedAssetIds: [draft.id],
        };
      },
    };
    return (
      <AssetReviewQueue
        assets={assets}
        preservation={{
          coverage: { fields: [], diagnostics: [], ready: true },
          noteSources: [],
          fieldOperations,
        }}
      />
    );
  }
  render(<Queue />);
  expect(screen.queryByRole('button', { name: 'Exclude', exact: true })).toBeNull();
  expect(screen.queryByRole('menuitem')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Created draft' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remove draft asset' }));
  expect(remove).toHaveBeenCalledWith([draft.id]);
  expect(screen.queryByRole('button', { name: 'Inspect Created draft' })).toBeNull();
  expect(screen.getByText(/1 draft removed/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Undo field changes' }));
  expect(undo).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Inspect Created draft' })).toBeTruthy();
});

it('offers restoration for an excluded asset from its action menu', () => {
  const asset: ReviewAsset = { ...draft, status: 'excluded' };
  const onAction = vi.fn();
  render(<AssetReviewQueue assets={[asset]} onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: 'Excluded 1' }));
  expect(screen.queryByRole('button', { name: 'Accept', exact: true })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Created draft' }));
  expect(screen.queryByRole('menuitem', { name: 'Exclude from import' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Restore to review' }));
  expect(onAction).toHaveBeenCalledExactlyOnceWith('restore', asset);
});
