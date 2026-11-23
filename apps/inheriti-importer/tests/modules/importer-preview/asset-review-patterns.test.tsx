import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AssetReviewQueue, type ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';
import { reviewPatterns } from '@modules/importer-preview/AssetReviewQueue/components/ReviewPatterns/patterns';

afterEach(cleanup);

function asset(id: string, overrides: Partial<ReviewAsset> = {}): ReviewAsset {
  return {
    id,
    name: id,
    type: 'USER-PSWD',
    status: 'suggested',
    rationale: '',
    mapped: [],
    unmapped: [],
    source: 'accounts.csv',
    sourceId: 'accounts',
    sourceNodeId: id,
    alternatives: [],
    schemaFields: [
      {
        key: 'secret.password',
        label: 'Password',
        candidates: [{ id: `${id}-password`, name: 'Password' }],
      },
    ],
    ...overrides,
  };
}

it('uses the projected key, isolates sources and types, and omits ambiguous same-entry members', () => {
  const key = { sourcePatternKey: 'accounts-password' };
  const first = asset('first', key);
  const second = asset('second', { ...key, unmapped: ['Newly unmapped'] });
  const patterns = reviewPatterns(
    [
      first,
      second,
      asset('duplicate A', { ...key, sourceNodeId: 'third' }),
      asset('duplicate B', { ...key, sourceNodeId: 'third' }),
      asset('other source', { ...key, sourceId: 'other' }),
      asset('other type', { ...key, type: 'API-KEY' }),
      asset('other schema', { sourcePatternKey: 'accounts-other' }),
    ],
    new Map([[second.id, 2]]),
  );
  expect(patterns).toHaveLength(1);
  expect(patterns[0]).toMatchObject({
    representative: first,
    assetIds: [first.id, second.id],
    fieldNames: ['Password'],
    issueCount: 2,
  });
});

it('uses visible entries in the pattern and applies mappings only after confirmation', () => {
  const first = asset('Match A');
  first.schemaFields![0].sourceFieldId = 'Match A-password';
  const second = asset('Match B');
  const onSelect = vi.fn();
  const onReviewAssets = vi.fn(() => ({ changedIds: [], skippedIds: [] }));
  const onApplyMappings = vi.fn(() => ({ changedIds: [second.id], skippedIds: [] }));
  render(
    <AssetReviewQueue
      assets={[asset('Third entry'), first, second, asset('Match C', { sourceId: 'other' })]}
      onSelect={onSelect}
      onReviewAssets={onReviewAssets}
      onApplyMappings={onApplyMappings}
    />,
  );

  fireEvent.change(screen.getByLabelText('Filter by source'), { target: { value: 'accounts' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search assets' }));
  const search = screen.getByRole('textbox', { name: 'Search assets' });
  fireEvent.change(search, { target: { value: 'Match' } });
  fireEvent.click(screen.getByRole('button', { name: 'Group similar entries' }));
  const panel = screen.getByRole('region', { name: 'Group similar entries' });
  fireEvent.click(
    within(panel).getByRole('button', { name: /Select Username and Password group, 2 entries/ }),
  );

  expect(onSelect).toHaveBeenCalledWith(first);
  expect(onReviewAssets).not.toHaveBeenCalled();
  expect(onApplyMappings).not.toHaveBeenCalled();
  expect(screen.getByText('2 selected')).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Group similar entries' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Inspect Third entry' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Inspect Match C' })).toBeNull();
  expect((search as HTMLInputElement).value).toBe('Match');

  fireEvent.click(screen.getByRole('button', { name: 'Apply this mapping…' }));
  expect(onApplyMappings).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm apply' }));
  expect(onApplyMappings).toHaveBeenCalledWith(first, [first, second]);
});

it('paginates groups and explains singleton results', () => {
  const assets = Array.from({ length: 21 }, (_, index) => [
    asset(`First ${index}`, { sourcePatternKey: String(index) }),
    asset(`Second ${index}`, { sourcePatternKey: String(index) }),
  ]).flat();
  render(
    <AssetReviewQueue
      assets={assets}
      onReviewAssets={() => ({ changedIds: [], skippedIds: [] })}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Group similar entries' }));
  const panel = screen.getByRole('region', { name: 'Group similar entries' });
  const patternRows = () => within(panel).getAllByRole('button', { name: /^Select / });
  expect(patternRows()).toHaveLength(20);
  fireEvent.click(within(panel).getByRole('button', { name: 'More groups' }));
  expect(patternRows()).toHaveLength(1);

  fireEvent.click(screen.getByRole('button', { name: 'Search assets' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search assets' }), {
    target: { value: 'Second' },
  });
  expect(screen.queryByRole('region', { name: 'Group similar entries' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Group similar entries' }));
  expect(screen.getByText(/No similar entries in this view/)).toBeTruthy();
});

it('opens groups outside the asset list and dismisses on Escape or outside click', () => {
  render(
    <AssetReviewQueue
      assets={[asset('First'), asset('Second')]}
      onReviewAssets={() => ({ changedIds: [], skippedIds: [] })}
    />,
  );
  const trigger = screen.getByRole('button', { name: 'Group similar entries' });
  const list = screen.getByRole('region', { name: 'Asset review list' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select First' }));
  fireEvent.click(trigger);
  const panel = screen.getByRole('region', { name: 'Group similar entries' });
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(list.contains(panel)).toBe(false);
  fireEvent.keyDown(panel, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: 'Group similar entries' })).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(screen.getByText('1 selected')).toBeTruthy();
  fireEvent.click(trigger);
  fireEvent.mouseDown(list);
  expect(screen.queryByRole('region', { name: 'Group similar entries' })).toBeNull();
});
