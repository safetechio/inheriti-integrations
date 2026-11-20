// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createEmptyImportSession, SensitiveValue } from '@modules/import/domain/import-model';
import { AssetReviewQueue, type ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';
import { sourceCoverage, type SourceCoverage } from '@modules/mapping/application/source-coverage';

afterEach(cleanup);

const account: ReviewAsset = {
  id: 'account',
  name: 'Work account',
  source: 'Work.1pux',
  sourceId: 'source',
  sourceNodeId: 'entry',
  folderPath: ['Work vault', 'Accounts'],
  type: 'USER-PSWD',
  status: 'needs-review',
  rationale: 'Field names matched Username and Password (2/5 fields).',
  alternatives: [],
  mapped: ['Login name'],
  unmapped: ['Recovery token'],
  note: {
    sourceFieldId: 'notes',
    destination: 'protected',
    explicit: false,
    inherited: false,
    publicAllowed: true,
  },
  schemaFields: [
    { key: 'secret.password', label: 'Password', required: true },
    {
      key: 'secret.email',
      label: 'Email',
      sourceFieldId: 'email',
      validationError: 'Invalid email',
    },
  ],
};

const field = (
  id: string,
  name: string,
  status: SourceCoverage['fields'][number]['status'],
  overrides: Partial<SourceCoverage['fields'][number]> = {},
): SourceCoverage['fields'][number] => ({
  id,
  name,
  status,
  sourceId: 'source',
  nodeId: 'entry',
  destinations: [],
  ...overrides,
});

const warning = {
  kind: 'unsupported' as const,
  code: 'attachment',
  sourceId: 'source',
  count: 1,
};

const coverage: SourceCoverage = {
  ready: false,
  fields: [
    field('username', 'Login name', 'protected', {
      destinations: [
        { assetId: 'account', fieldId: 'secret.username' },
        { assetId: 'companion', fieldId: 'secret.text' },
      ],
    }),
    field('notes', 'Imported notes', 'protected', {
      destinations: [{ assetId: 'companion', fieldId: 'secret.text' }],
    }),
    field('recovery', 'Recovery token', 'pending'),
    field('email', 'Work email', 'invalid'),
    field('obsolete', 'Old token', 'excluded'),
    field('other-source', 'Other source field', 'pending', { sourceId: 'other' }),
    field('other-entry', 'Other entry field', 'pending', { nodeId: 'other' }),
  ],
  diagnostics: [
    { ...warning, entryId: 'entry', message: 'Entry attachment was skipped.' },
    { ...warning, entryId: 'other', message: 'Other entry warning.' },
    { ...warning, entryId: 'entry', sourceId: 'other', message: 'Other source warning.' },
    { ...warning, message: 'File-wide warning.' },
  ],
};

const dialogName = { name: 'Work account — Review details' };
const detailsButton = { name: 'View asset review details' };

it('shows scoped review reasons and coverage from the Details action without resolving values', () => {
  const resolveSourceValue = vi.fn(() => new SensitiveValue('synthetic protected value'));
  const onSelect = vi.fn();
  render(
    <AssetReviewQueue
      assets={[account]}
      selectedId={account.id}
      onSelect={onSelect}
      resolveSourceValue={resolveSourceValue}
      preservation={{ coverage, noteSources: [] }}
    />,
  );
  fireEvent.click(screen.getByRole('button', detailsButton));
  const dialog = within(screen.getByRole('dialog', dialogName));
  for (const label of [
    'Work.1pux · Work vault · Accounts',
    account.rationale,
    'Password — Required field is missing.',
    'Email — Invalid email',
    'Choose a destination for the imported notes. They remain protected while you decide.',
    'Login name',
    'Pending a destination',
    'Invalid destination — review required',
    'Explicitly excluded from import',
    'Entry attachment was skipped.',
  ])
    expect(dialog.getByText(label)).toBeTruthy();

  for (const label of [
    'Other source field',
    'Other entry field',
    'Other entry warning.',
    'Other source warning.',
    'File-wide warning.',
    'synthetic protected value',
  ])
    expect(dialog.queryByText(label)).toBeNull();

  const username = within(dialog.getByText('Login name').parentElement!);
  expect(username.getByText('Mapped · This asset · Username')).toBeTruthy();
  expect(username.getByText('Preserved in an additional asset · Protected text')).toBeTruthy();
  expect(username.queryByText('Protected text · This asset · Username')).toBeNull();
  expect(dialog.getAllByRole('button')).toEqual([
    dialog.getByRole('button', { name: 'Close Work account — Review details' }),
    dialog.getByRole('button', { name: 'Done' }),
  ]);
  expect(resolveSourceValue).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(onSelect).not.toHaveBeenCalled();
});

it('opens from the status badge by click, Enter or Space and isolates review shortcuts', async () => {
  const onAcceptAllEligible = vi.fn(() => 1);
  const onAction = vi.fn();
  const onSelect = vi.fn();
  const onReviewAssets = vi.fn(() => ({ changedIds: [], skippedIds: [] }));
  render(
    <AssetReviewQueue
      assets={[account, { ...account, id: 'next', name: 'Next account' }]}
      onAction={onAction}
      onSelect={onSelect}
      onAcceptAllEligible={onAcceptAllEligible}
      onReviewAssets={onReviewAssets}
    />,
  );
  const selected = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select Work account' });
  fireEvent.click(selected);
  expect(selected.checked).toBe(true);
  const badge = screen.getByRole('button', { name: 'Needs review' });
  expect(badge.tabIndex).toBe(0);
  badge.focus();
  expect(document.activeElement).toBe(badge);
  for (const key of ['click', 'Enter', ' ']) {
    if (key === 'click') fireEvent.click(badge);
    else fireEvent.keyDown(badge, { key });
    const dialog = screen.getByRole('dialog', dialogName);
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    const focused = document.activeElement!;
    for (const target of [focused, document.body]) {
      fireEvent.keyDown(target, { key: 'a' });
      fireEvent.keyDown(target, { key: 'x' });
      fireEvent.keyDown(target, { key: 'A', ctrlKey: true, shiftKey: true });
      fireEvent.keyDown(target, { key: 'A', metaKey: true, shiftKey: true });
      fireEvent.keyDown(target, { key: 'ArrowDown' });
      fireEvent.keyDown(target, { key: 'ArrowUp' });
    }
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(badge);
    expect(selected.checked).toBe(true);
  }
  expect(onReviewAssets).not.toHaveBeenCalled();
  expect(onAction).not.toHaveBeenCalled();
  expect(onAcceptAllEligible).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
});

it('closes when switching assets and uses only direct destinations for an asset without an entry ID', () => {
  const other: ReviewAsset = {
    ...account,
    id: 'other',
    name: 'Other account',
    sourceNodeId: undefined,
    type: 'PLAIN-TEXT',
    status: 'fallback',
    note: undefined,
    schemaFields: [],
  };
  const props = {
    assets: [account, other],
    preservation: {
      coverage: {
        ...coverage,
        fields: [
          ...coverage.fields,
          field('memo', 'Other asset memo', 'protected', {
            destinations: [{ assetId: other.id, fieldId: 'secret.text' }],
            nodeId: 'dedicated',
          }),
        ],
      },
      noteSources: [],
    },
  };
  const { rerender } = render(<AssetReviewQueue {...props} selectedId={account.id} />);
  fireEvent.click(screen.getByRole('button', detailsButton));
  expect(screen.getByRole('dialog', dialogName)).toBeTruthy();

  rerender(<AssetReviewQueue {...props} selectedId={other.id} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', detailsButton));
  const dialog = within(screen.getByRole('dialog', { name: 'Other account — Review details' }));
  expect(dialog.getByText('Other asset memo')).toBeTruthy();
  expect(dialog.queryByText('Login name')).toBeNull();
  expect(dialog.queryByText('File-wide warning.')).toBeNull();
});

it('explains an absent protected mapping even without required field flags', () => {
  const unmappedAccount: ReviewAsset = {
    ...account,
    note: undefined,
    schemaFields: [
      { key: 'secret.username', label: 'Username' },
      { key: 'secret.password', label: 'Password' },
    ],
  };
  const { rerender } = render(<AssetReviewQueue assets={[unmappedAccount]} />);
  fireEvent.click(screen.getByRole('button', { name: 'All 1' }));
  fireEvent.click(screen.getByRole('button', detailsButton));
  const mappingReason = 'Map at least one protected field before accepting this asset.';
  const details = () => within(screen.getByRole('dialog', dialogName));
  expect(details().getByText(mappingReason)).toBeTruthy();

  rerender(
    <AssetReviewQueue
      assets={[
        {
          ...unmappedAccount,
          type: 'PLAIN-TEXT',
          status: 'fallback',
          schemaFields: [{ key: 'secret.text', label: 'Text', required: true }],
          plainTextValue: new SensitiveValue('synthetic literal'),
        },
      ]}
    />,
  );
  expect(details().queryByText(mappingReason)).toBeNull();
  expect(details().queryByText(/Required field is missing/)).toBeNull();
  expect(details().queryByText('synthetic literal')).toBeNull();

  rerender(
    <AssetReviewQueue
      assets={[
        {
          ...unmappedAccount,
          status: 'excluded',
          note: account.note,
          schemaFields: [{ key: 'secret.password', label: 'Password', required: true }],
        },
      ]}
    />,
  );
  expect(details().queryByText(mappingReason)).toBeNull();
  expect(details().queryByText(/Required field is missing/)).toBeNull();
  expect(details().queryByText(/Choose a destination/)).toBeNull();
});

it('distinguishes an invalid destination from valid companion coverage for the same field', () => {
  const session = createEmptyImportSession('session');
  session.fieldsById.email = {
    id: 'email',
    sourceId: 'source',
    parentNodeId: 'entry',
    sourcePath: [],
    name: 'Work email',
    value: new SensitiveValue('synthetic invalid email'),
    metadata: {},
  };
  const binding = { kind: 'source', sourceFieldId: 'email' } as const;
  const coverage = sourceCoverage(
    session,
    [
      {
        id: account.id,
        name: account.name,
        type: 'USER-PSWD',
        fieldBindings: { 'secret.email': binding },
      },
      {
        id: 'companion',
        name: 'Companion',
        type: 'PLAIN-TEXT',
        fieldBindings: { 'secret.text': binding },
      },
    ],
    new Set(),
  );
  expect(coverage.ready).toBe(true);
  expect(coverage.fields[0]?.destinations).toEqual([
    { assetId: account.id, fieldId: 'secret.email', valid: false },
    { assetId: 'companion', fieldId: 'secret.text', valid: true },
  ]);
  render(<AssetReviewQueue assets={[account]} preservation={{ coverage, noteSources: [] }} />);
  fireEvent.click(screen.getByRole('button', detailsButton));
  const dialog = within(screen.getByRole('dialog', dialogName));
  expect(dialog.getByText('Invalid destination · This asset · Email')).toBeTruthy();
  expect(dialog.queryByText('Mapped · This asset · Email')).toBeNull();
  expect(dialog.getByText('Preserved in an additional asset · Protected text')).toBeTruthy();
});
