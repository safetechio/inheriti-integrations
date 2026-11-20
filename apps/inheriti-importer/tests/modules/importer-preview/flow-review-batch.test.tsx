import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { ImporterFlow } from '@modules/importer-preview/ImporterFlow';
import { useImporterFlow } from '@modules/importer-preview/ImporterFlow/hooks/use-importer-flow';
import {
  flowReducer,
  type FlowState,
} from '@modules/importer-preview/ImporterFlow/hooks/flow-reducer';
import { getReviewBatchResult } from '@modules/importer-preview/ImporterFlow/hooks/flow-review-batch';
import type { ReviewAsset } from '@modules/importer-preview/AssetReviewQueue/types';

afterEach(cleanup);

const first: ReviewAsset = {
  id: 'first',
  name: 'First',
  type: 'USER-PSWD',
  status: 'suggested',
  rationale: '',
  mapped: [],
  unmapped: [],
  source: 'Synthetic source',
  alternatives: [],
};
const invalid: ReviewAsset = { ...first, id: 'invalid', schemaFields: [] };
const assigned = { ...first, valid: true };
const initial: FlowState = {
  files: [],
  stage: 'assets',
  stagingState: 'idle',
  assets: [first, invalid],
  unassigned: [],
  plans: [],
};

it('accepts each eligible current asset once and undoes its review and grouping changes', () => {
  const ids = [first.id, first.id, invalid.id, 'missing'];
  expect(getReviewBatchResult(initial.assets, 'accept', ids)).toEqual({
    changedIds: ['first'],
    skippedIds: ['invalid', 'missing'],
  });
  const reviewed = flowReducer(initial, { type: 'review-batch', action: 'accept', ids });
  expect(reviewed.assets.map((asset) => asset.status)).toEqual(['accepted', 'suggested']);
  expect(reviewed.unassigned.map((asset) => asset.id)).toEqual(['first']);
  const selected = flowReducer(reviewed, { type: 'select-asset', asset: invalid });
  const undone = flowReducer(selected, { type: 'undo-review-batch' });
  expect(undone).toMatchObject({
    assets: initial.assets,
    unassigned: [],
    selectedAssetId: invalid.id,
  });
  expect(undone.reviewBatchUndo).toBeUndefined();
});

it('removes and restores batch-excluded assignments and invalidates undo after an edit', () => {
  const accepted = {
    ...initial,
    assets: [{ ...first, status: 'accepted' as const }, invalid],
    plans: [
      {
        id: 'plan',
        name: 'Plan',
        assets: 1,
        capacity: '1 / 50 Assets',
        valid: true,
        assignedAssets: [assigned],
      },
    ],
  };
  const excluded = flowReducer(accepted, {
    type: 'review-batch',
    action: 'exclude',
    ids: ['first'],
  });
  expect(excluded.plans[0]).toMatchObject({
    assets: 0,
    capacity: '0 / 50 Assets',
    assignedAssets: [],
  });
  expect(flowReducer(excluded, { type: 'undo-review-batch' })).toMatchObject({
    assets: accepted.assets,
    plans: accepted.plans,
  });

  const deleted = flowReducer(excluded, { type: 'delete-plan', id: 'plan' });
  expect(flowReducer(deleted, { type: 'undo-review-batch' })).toBe(deleted);
  const manual = flowReducer(excluded, {
    type: 'review-asset',
    action: 'exclude',
    asset: invalid,
    autoAdvance: false,
  });
  expect(flowReducer(manual, { type: 'undo-review-batch' })).toBe(manual);
});

it('repairs grouping validity when an eligible asset is accepted and restores it on undo', () => {
  const grouped = { ...assigned, type: 'PLAIN-TEXT', valid: false };
  const pending = { ...initial, unassigned: [grouped] };
  const accepted = flowReducer(pending, {
    type: 'review-batch',
    action: 'accept',
    ids: [first.id],
  });
  expect(accepted.unassigned).toEqual([{ ...grouped, type: first.type, valid: true }]);
  expect(flowReducer(accepted, { type: 'undo-review-batch' }).unassigned).toEqual([grouped]);
});

it.each([false, true])('respects auto-advance set to %s in the review queue', (autoAdvance) => {
  const onReviewAsset = vi.fn();
  const onSelectAsset = vi.fn();
  render(
    <ImporterFlow
      files={[{ name: first.source, format: 'Synthetic', status: 'imported' }]}
      assets={[first, { ...first, id: 'second', name: 'Second' }]}
      plans={[]}
      unassigned={[]}
      checklist={[]}
      initialStage="assets"
      autoAdvance={autoAdvance}
      callbacks={{ onReviewAsset, onSelectAsset }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Inspect First' }));
  onSelectAsset.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Exclude' }));
  expect(onReviewAsset).toHaveBeenCalledWith('exclude', first);
  expect(onSelectAsset).toHaveBeenCalledTimes(Number(autoAdvance));
  expect(document.querySelector('.asset-inspector-heading-text')?.textContent).toBe(
    autoAdvance ? 'Second' : 'First',
  );
});

it.each([false, true])('respects auto-advance set to %s on a direct flow review', (autoAdvance) => {
  const second = { ...first, id: 'second' };
  const { result } = renderHook(() =>
    useImporterFlow({
      files: [],
      assets: [first, second],
      unassigned: [],
      plans: [],
      initialStage: 'assets',
      autoAdvance,
    }),
  );
  act(() => result.current.reviewAsset('exclude', first));
  expect(result.current.selectedAssetId).toBe(autoAdvance ? second.id : first.id);
});
