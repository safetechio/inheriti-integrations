import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  AssetReviewQueue,
  type ReviewAsset,
  type ReviewRecoveryHandle,
} from '@modules/importer-preview/AssetReviewQueue';
import { useReviewList } from '@modules/importer-preview/AssetReviewQueue/hooks/use-review-list';
import { getReviewBlockers } from '@modules/importer-preview/AssetReviewQueue/review-blockers';
import type { ImportReviewControls } from '@modules/importer-preview/AssetReviewQueue/import-review-controls';
import type {
  ImportCoverage,
  SourceCoverageField,
} from '@modules/importer-preview/AssetReviewQueue/types';

afterEach(cleanup);

const asset = (id: string, props: Partial<ReviewAsset> = {}): ReviewAsset => ({
  id,
  name: id,
  source: 'Alpha',
  sourceId: 'alpha',
  sourceNodeId: id,
  status: 'accepted',
  type: 'USER-PSWD',
  rationale: '',
  alternatives: [],
  mapped: [],
  unmapped: [],
  ...props,
});
const note: NonNullable<ReviewAsset['note']> = {
  sourceFieldId: 'native-note',
  destination: 'protected',
  explicit: false,
  inherited: false,
  publicAllowed: true,
};
const field = (
  id: string,
  nodeId: string,
  status: SourceCoverageField['status'] = 'pending',
): SourceCoverageField => ({
  id,
  sourceId: 'alpha',
  nodeId,
  name: id,
  status,
  destinations: [],
});
const coverage = (...fields: SourceCoverageField[]): ImportCoverage => ({
  fields,
  diagnostics: [],
  ready: fields.every(({ status }) => status !== 'pending' && status !== 'invalid'),
});
const result = { changedIds: [], skippedIds: [] };
const button = (name: string) => screen.getByRole('button', { name });
const click = (name: string) => fireEvent.click(button(name));

it('counts unique unchosen notes and real destination gaps across all assets', () => {
  const assets = [
    asset('Alpha', { note }),
    asset('Alpha-copy', { note }),
    asset('Hidden', { status: 'excluded', note: { ...note, sourceFieldId: 'excluded-asset' } }),
    asset('Explicit-public', {
      note: { ...note, sourceFieldId: 'public', explicit: true, destination: 'asset-notes' },
    }),
    asset('Explicit-private', { note: { ...note, sourceFieldId: 'private', explicit: true } }),
    asset('Excluded-field', { note: { ...note, sourceFieldId: 'excluded-field' } }),
    asset('Proposed', {
      status: 'suggested',
      schemaFields: [{ key: 'secret.password', label: 'Password', sourceFieldId: 'proposed' }],
    }),
  ];
  expect(
    getReviewBlockers(
      assets,
      coverage(
        field('native-note', 'Alpha'),
        field('token', 'Alpha'),
        field('bad', 'Alpha', 'invalid'),
        field('excluded-field', 'Excluded-field', 'excluded'),
        field('excluded-asset', 'Hidden', 'excluded'),
        field('proposed', 'Proposed'),
      ),
    ),
  ).toEqual({ pendingFieldCount: 1, invalidFieldCount: 1, pendingNoteCount: 1, undecidedCount: 1 });
});

it('opens global notes across source filters and waits for an explicit choice', () => {
  const recoveryRef = createRef<ReviewRecoveryHandle>();
  const onSetSourceNoteDestination = vi.fn(() => result);
  const preservation: ImportReviewControls = {
    coverage: coverage(field('native-note', 'Alpha')),
    noteSources: [
      { sourceId: 'alpha', sourceName: 'Alpha', fieldCount: 1, destination: 'protected' },
      { sourceId: 'beta', sourceName: 'Beta', fieldCount: 1, destination: 'protected' },
    ],
    onSetSourceNoteDestination,
  };
  render(
    <AssetReviewQueue
      assets={[
        asset('Alpha', { note, status: 'excluded' }),
        asset('Beta', { sourceId: 'beta', source: 'Beta' }),
      ]}
      preservation={preservation}
      recoveryRef={recoveryRef}
    />,
  );
  fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'beta' } });
  act(() => recoveryRef.current?.resolve());
  const dialog = screen.getByRole('dialog', { name: 'Choose notes destination' });
  expect(
    within(dialog).getByRole('radiogroup', { name: 'Notes destination · All sources · 2 fields' }),
  ).toBeTruthy();
  expect(onSetSourceNoteDestination).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('radio', { name: 'As secret' }));
  expect(onSetSourceNoteDestination).toHaveBeenCalledWith(null, 'protected');
  fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'beta' } });
  fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'all' } });
  expect(screen.queryByRole('dialog', { name: 'Choose notes destination' })).toBeNull();
});

it('reveals undecided assets globally, then opens the relevant coverage tab', () => {
  const recoveryRef = createRef<ReviewRecoveryHandle>();
  const accepted = asset('Alpha');
  const undecided = asset('Beta', { status: 'suggested', sourceId: 'beta', source: 'Beta' });
  const onSelect = vi.fn();
  const pending = field('orphan', 'no-asset');
  const invalid = field('bad', 'no-asset', 'invalid');
  const props = { recoveryRef, onSelect, onReviewAssets: () => result };
  const view = render(
    <AssetReviewQueue
      {...props}
      assets={[accepted, undecided]}
      preservation={{ coverage: coverage(pending, invalid), noteSources: [] }}
    />,
  );
  fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'alpha' } });
  act(() => recoveryRef.current?.resolve());
  expect(onSelect).toHaveBeenLastCalledWith(undecided);
  expect(screen.queryByRole('dialog')).toBeNull();

  click('All 2');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Beta' }));
  expect(screen.getByText('1 selected')).toBeTruthy();
  act(() => recoveryRef.current?.resolve());
  expect(button('To review 1').getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByText('1 selected')).toBeNull();

  click('Select all');
  act(() => recoveryRef.current?.resolve());
  expect(screen.getByText('1 selected')).toBeTruthy();

  for (const [fields, tab] of [
    [[pending, invalid], 'Invalid'],
    [[pending], 'Unassigned'],
  ] as const) {
    view.rerender(
      <AssetReviewQueue
        {...props}
        assets={[accepted]}
        preservation={{ coverage: coverage(...fields), noteSources: [] }}
      />,
    );
    act(() => recoveryRef.current?.resolve());
    const dialog = within(screen.getByRole('dialog', { name: 'Source field details' }));
    expect(
      dialog.getByRole('button', { name: `Show ${tab} fields` }).getAttribute('aria-pressed'),
    ).toBe('true');
    click('Close Source field details');
  }
});

it('opens actual issues on accepted assets without changing the bulk selection', () => {
  const warningOnly = asset('Warning only', { unmapped: ['old hint'] });
  const real = asset('Needs a field', { unmappedSourceFieldIds: ['token'] });
  const ignored = asset('Ignored', { status: 'excluded', unmapped: ['skipped hint'] });
  const onSelect = vi.fn();
  const sourceCoverage = {
    ...coverage(field('token', real.id)),
    diagnostics: [
      {
        sourceId: 'alpha',
        entryId: warningOnly.id,
        kind: 'unsupported' as const,
        code: 'attachment',
        message: 'Attachment unsupported',
        count: 1,
      },
    ],
  };
  const props = { onSelect, onReviewAssets: () => result };
  const view = render(
    <AssetReviewQueue
      {...props}
      assets={[warningOnly, real, ignored]}
      preservation={{ coverage: sourceCoverage, noteSources: [] }}
    />,
  );
  const selected = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select Warning only' });
  const target = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select Needs a field' });
  fireEvent.click(selected);
  click('Focus next issue');
  expect(onSelect).toHaveBeenLastCalledWith(real);
  const dialog = within(screen.getByRole('dialog', { name: 'Needs a field — Issues' }));
  expect(dialog.getByText('token')).toBeTruthy();
  expect(selected.checked).toBe(true);
  expect(target.checked).toBe(false);
  click('Close Needs a field — Issues');

  view.rerender(
    <AssetReviewQueue
      {...props}
      assets={[warningOnly, real, ignored]}
      preservation={{
        coverage: { ...sourceCoverage, fields: [field('token', real.id, 'excluded')] },
        noteSources: [],
      }}
    />,
  );
  expect(button('Focus next issue').getAttribute('aria-disabled')).toBe('true');
});

it('finds accepted assets with pending fields in a thousand-entry source', () => {
  const assets = Array.from({ length: 1000 }, (_, index) =>
    asset(`entry-${index}`, {
      unmappedSourceFieldIds: [`field-${index}`],
    }),
  );
  const fields = assets.map(({ id }, index) =>
    field(`field-${index}`, id, index === 999 ? 'pending' : 'mapped'),
  );
  const preserved = coverage(...fields);
  const { result } = renderHook(() => useReviewList(assets, [], preserved));
  expect([...result.current.issues]).toEqual([['entry-999', 1]]);
  expect(result.current.exceptionCounts.omitted).toBe(1);
});
