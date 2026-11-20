import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SensitiveValue } from '@modules/import/domain/import-model';
import type { SourceCoverage } from '@modules/mapping/application/source-coverage';
import { AssetReviewQueue, type ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';
import { ImporterFlow } from '@modules/importer-preview/ImporterFlow';
import type { ImportReviewControls } from '@modules/importer-preview/AssetReviewQueue/import-review-controls';
import { NotesField } from '@modules/importer-preview/AssetReviewQueue/components/NotesField';

afterEach(cleanup);

it('keeps native notes separate from any distinct public metadata mapping', () => {
  const onMapField = vi.fn();
  const resolveSourceValue = (id: string) => new SensitiveValue(`synthetic-${id}`);
  const field = {
    key: 'meta.notes',
    label: 'Notes',
    sourceFieldId: 'native-note',
    candidates: [
      { id: 'native-note', name: 'Notes' },
      { id: 'other-field', name: 'Other field' },
    ],
  };
  const publicAsset = {
    ...account,
    note: { ...account.note!, destination: 'asset-notes' as const, explicit: true },
  };
  const { rerender } = render(
    <NotesField
      asset={publicAsset}
      field={field}
      onMapField={onMapField}
      resolveSourceValue={resolveSourceValue}
    />,
  );
  expect(screen.getByText('synthetic-native-note')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Change Notes source field' })).toBeNull();

  rerender(
    <NotesField
      asset={account}
      field={{ ...field, sourceFieldId: 'other-field' }}
      onMapField={onMapField}
      resolveSourceValue={resolveSourceValue}
    />,
  );
  expect(screen.queryByText('synthetic-native-note')).toBeNull();
  expect(screen.getByText('synthetic-other-field')).toBeTruthy();
  expect(screen.getByText(/Another source field is mapped to Asset notes/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear Asset notes mapping' }));
  expect(onMapField).toHaveBeenCalledWith(account, 'meta.notes', undefined);
});

const files = [
  { id: 'alpha', name: 'Alpha.1pux', format: '1Password', status: 'imported' as const },
  { id: 'bravo', name: 'Bravo.kdbx', format: 'KeePass', status: 'imported' as const },
];
const account: ReviewAsset = {
  id: 'account',
  sourceId: 'alpha',
  sourceNodeId: 'entry',
  source: 'Alpha.1pux',
  name: 'Account',
  type: 'USER-PSWD',
  status: 'accepted',
  rationale: '',
  mapped: [],
  unmapped: ['OTP', 'Comment'],
  alternatives: [],
  note: {
    sourceFieldId: 'native-note',
    destination: 'protected',
    explicit: false,
    inherited: false,
    publicAllowed: true,
  },
  schemaFields: [{ key: 'meta.notes', label: 'Notes or guidelines' }],
};
const coverage: SourceCoverage = {
  fields: [
    {
      id: 'otp',
      name: 'OTP',
      sourceId: 'alpha',
      nodeId: 'entry',
      status: 'pending',
      destinations: [],
    },
    {
      id: 'comment',
      name: 'Comment',
      sourceId: 'alpha',
      nodeId: 'entry',
      status: 'pending',
      destinations: [],
    },
    {
      id: 'excluded',
      name: 'Old token',
      sourceId: 'alpha',
      nodeId: 'entry',
      status: 'excluded',
      destinations: [],
    },
    {
      id: 'mapped',
      name: 'Username',
      sourceId: 'alpha',
      nodeId: 'entry',
      status: 'mapped',
      destinations: [{ assetId: 'account', fieldId: 'secret.username' }],
    },
    {
      id: 'protected',
      name: 'Notes',
      sourceId: 'alpha',
      nodeId: 'entry',
      status: 'protected',
      destinations: [{ assetId: 'companion', fieldId: 'secret.text' }],
    },
  ],
  diagnostics: [
    {
      sourceId: 'bravo',
      code: 'attachment',
      kind: 'unsupported',
      message: 'Attachments are unsupported.',
      count: 2,
    },
  ],
  ready: false,
};
const preservation: ImportReviewControls = {
  coverage,
  noteSources: [
    { sourceId: 'alpha', sourceName: 'Alpha.1pux', fieldCount: 1, destination: null },
    { sourceId: 'bravo', sourceName: 'Bravo.kdbx', fieldCount: 2, destination: null },
  ],
};

it('scopes the bulk notes choice and masks a protected note until a deliberate reveal', () => {
  const onSetSourceNoteDestination = vi.fn(() => ({
    changedIds: [],
    skippedIds: ['protected-note'],
  }));
  const onSetAssetNoteDestination = vi.fn(() => ({ changedIds: ['account'], skippedIds: [] }));
  const resolveSourceValue = vi.fn(() => new SensitiveValue('synthetic-note'));
  const controls = { ...preservation, onSetSourceNoteDestination, onSetAssetNoteDestination };
  const { rerender } = render(
    <AssetReviewQueue
      assets={[account]}
      sourceFiles={files}
      resolveSourceValue={resolveSourceValue}
      preservation={controls}
    />,
  );
  expect(resolveSourceValue).not.toHaveBeenCalled();
  expect(screen.queryByText('synthetic-note')).toBeNull();
  fireEvent.change(screen.getByLabelText('Notes destination · All sources · 3 fields'), {
    target: { value: 'asset-notes' },
  });
  expect(onSetSourceNoteDestination).toHaveBeenLastCalledWith(null, 'asset-notes');
  expect(screen.getByText(/1 note skipped/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'alpha' } });
  fireEvent.change(screen.getByLabelText('Notes destination · Alpha.1pux · 1 field'), {
    target: { value: 'protected' },
  });
  expect(onSetSourceNoteDestination).toHaveBeenLastCalledWith('alpha', 'protected');
  fireEvent.change(screen.getByLabelText('Notes destination for this asset'), {
    target: { value: 'asset-notes' },
  });
  expect(onSetAssetNoteDestination).toHaveBeenCalledWith(account, 'asset-notes');
  fireEvent.click(screen.getByRole('button', { name: 'Reveal Notes or guidelines value' }));
  expect(screen.getByText('synthetic-note')).toBeTruthy();

  const inherited = {
    ...account,
    note: { ...account.note!, explicit: true, inherited: true },
  };
  rerender(
    <AssetReviewQueue
      assets={[inherited]}
      sourceFiles={files}
      resolveSourceValue={resolveSourceValue}
      preservation={controls}
    />,
  );
  const choice = screen.getByLabelText('Notes destination for this asset') as HTMLSelectElement;
  expect(choice.selectedOptions[0]?.textContent).toBe('Source choice — Protected content');
  fireEvent.change(choice, { target: { value: 'protected' } });
  expect(onSetAssetNoteDestination).toHaveBeenLastCalledWith(inherited, 'protected');

  const note = {
    ...account.note!,
    publicAllowed: false,
    reason: 'Requires another protected field.',
  };
  rerender(
    <AssetReviewQueue
      assets={[{ ...account, note }]}
      sourceFiles={files}
      resolveSourceValue={resolveSourceValue}
      preservation={controls}
    />,
  );
  expect(
    within(screen.getByLabelText('Notes destination for this asset')).queryByRole('option', {
      name: /Asset notes/,
    }),
  ).toBeNull();
  expect(screen.getByText(note.reason)).toBeTruthy();
});

it('reports coverage including diagnostics for files with no assets and resolves selected fields', () => {
  const onPreserveFields = vi.fn(() => ({ changedIds: ['otp'], skippedIds: [] }));
  const onExcludeFields = vi.fn(() => ({ changedIds: ['comment'], skippedIds: [] }));
  render(
    <AssetReviewQueue
      assets={[account]}
      sourceFiles={files}
      preservation={{ ...preservation, onPreserveFields, onExcludeFields }}
    />,
  );
  expect(
    screen.getByText('1 mapped · 1 protected text · 1 excluded · 2 pending · 2 unsupported'),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'View source field details' }));
  expect(screen.getByText('Attachments are unsupported.')).toBeTruthy();
  expect(screen.getByText('Bravo.kdbx · Unsupported · 2')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'OTP from Alpha.1pux' }));
  fireEvent.click(screen.getByRole('button', { name: 'Preserve as protected text' }));
  expect(onPreserveFields).toHaveBeenCalledWith(['otp']);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Comment from Alpha.1pux' }));
  fireEvent.click(screen.getByRole('button', { name: 'Exclude fields' }));
  expect(onExcludeFields).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm exclusion' }));
  expect(onExcludeFields).toHaveBeenCalledWith(['comment']);
});

it('keeps accepted assets at review until preservation is ready', () => {
  const props = {
    files,
    assets: [account],
    unassigned: [],
    plans: [],
    checklist: [],
    initialStage: 'assets' as const,
  };
  const { rerender } = render(<ImporterFlow {...props} preservation={preservation} />);
  expect(screen.getByRole('button', { name: 'Continue' }).getAttribute('aria-disabled')).toBe(
    'true',
  );
  expect(screen.getByText('Resolve pending fields and notes destinations.')).toBeTruthy();
  rerender(
    <ImporterFlow
      {...props}
      preservation={{ ...preservation, coverage: { ...coverage, ready: true } }}
    />,
  );
  expect(screen.getByRole('button', { name: 'Continue' }).getAttribute('aria-disabled')).not.toBe(
    'true',
  );
});

it('requires acknowledgment once for warning diagnostics on zero-asset sources', () => {
  const props = { assets: [], unassigned: [], plans: [], checklist: [], callbacks: {} };
  const source = {
    ...files[1]!,
    status: 'warning' as const,
    diagnostics: coverage.diagnostics,
    entries: 0,
  };
  const { rerender } = render(<ImporterFlow {...props} files={[source]} />);
  expect(screen.getByRole('button', { name: 'Continue' }).getAttribute('aria-disabled')).toBe(
    'true',
  );
  rerender(<ImporterFlow {...props} files={[{ ...source, warningsAcknowledged: true }]} />);
  expect(screen.getByRole('button', { name: 'Continue' }).getAttribute('aria-disabled')).not.toBe(
    'true',
  );
});
