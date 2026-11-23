// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createEmptyImportSession, SensitiveValue } from '@modules/import/domain/import-model';
import { AssetReviewQueue, type ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';
import { AssetReviewDetails } from '@modules/importer-preview/AssetReviewQueue/components/AssetReviewDetails';
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
    {
      ...warning,
      entryId: 'entry',
      sourcePath: ['items', '0', 'attachments'],
      message: 'Entry attachment was skipped.',
      count: 2,
    },
    { ...warning, entryId: 'other', message: 'Other entry warning.' },
    { ...warning, entryId: 'entry', sourceId: 'other', message: 'Other source warning.' },
    { ...warning, message: 'File-wide warning.' },
  ],
};

const dialogName = { name: 'Work account — Issues' };
const detailsButton = { name: 'View asset issues' };

it('explains when an asset needs review without specific issues', () => {
  render(
    <AssetReviewQueue
      assets={[{ ...account, schemaFields: [], unmapped: [], note: undefined }]}
      selectedId={account.id}
    />,
  );
  fireEvent.click(screen.getByRole('button', detailsButton));
  expect(
    within(screen.getByRole('dialog', dialogName)).getByText('No issues found. Ready for review.'),
  ).toBeTruthy();
});

it('counts the scoped issues before opening and updates the badge as they are resolved', () => {
  const duplicate = {
    key: 'secret.website',
    label: 'Website',
    sourceFieldId: 'email',
    validationError: 'Invalid website',
  };
  const asset = { ...account, schemaFields: [...account.schemaFields!, duplicate] };
  const overlappingCoverage = {
    ...coverage,
    fields: coverage.fields.map((entry) =>
      entry.id === 'notes' ? { ...entry, status: 'pending' as const } : entry,
    ),
  };
  const details = (current: ReviewAsset, report: SourceCoverage) => (
    <AssetReviewDetails
      asset={current}
      coverage={report}
      sourceFields={report.fields.filter(
        ({ sourceId, nodeId }) => sourceId === current.sourceId && nodeId === current.sourceNodeId,
      )}
      siblings={[]}
    />
  );
  const view = render(details(asset, overlappingCoverage));
  const badge = () => screen.getByRole('button', detailsButton);
  expect(badge().textContent).toContain('Needs review (4)');
  expect(screen.queryByRole('dialog', dialogName)).toBeNull();
  view.rerender(details({ ...asset, status: 'excluded' }, overlappingCoverage));
  expect(badge().textContent).toContain('Excluded');
  expect(badge().textContent).not.toMatch(/\(\d+\)/);
  view.rerender(
    details(
      { ...asset, schemaFields: [], unmapped: [], note: undefined },
      { ...coverage, fields: [], diagnostics: [] },
    ),
  );
  expect(badge().textContent).toContain('Suggested');
  expect(badge().textContent).not.toMatch(/\(\d+\)/);
});

it('shows only scoped issues without repeating valid fields or resolving values', () => {
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
    'Password — Required field is missing.',
    'Email — Invalid email',
    'Choose a destination for the imported notes. They remain protected while you decide.',
    'Recovery token',
    'Work email',
    'No destination is assigned.',
  ])
    expect(dialog.getByText(label)).toBeTruthy();

  for (const label of [
    'Work.1pux · Work vault · Accounts',
    account.rationale,
    'Needs review',
    'Login name',
    'Old token',
    'Other source field',
    'Other entry field',
    'Other entry warning.',
    'Other source warning.',
    'File-wide warning.',
    'synthetic protected value',
  ])
    expect(dialog.queryByText(label)).toBeNull();

  expect(dialog.queryByText('Entry attachment was skipped.')).toBeNull();
  fireEvent.click(dialog.getByRole('button', { name: /Warnings/ }));
  expect(dialog.getAllByText('Entry attachment was skipped.')).toHaveLength(1);
  expect(dialog.getByText('Unsupported · 3')).toBeTruthy();
  fireEvent.click(dialog.getByRole('button', { name: 'View details (3)' }));
  expect(dialog.getAllByRole('listitem')).toHaveLength(2);
  expect(dialog.getByText('items › 0 › attachments')).toBeTruthy();
  expect(dialog.getByText('2 occurrences')).toBeTruthy();
  expect(dialog.queryByText('Recovery token')).toBeNull();
  expect(dialog.queryByText('Other entry warning.')).toBeNull();
  expect(resolveSourceValue).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole('button', { name: 'Close Work account — Issues' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(onSelect).not.toHaveBeenCalled();
});

it('opens from the keyboard-accessible Issues button and isolates review shortcuts', async () => {
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
  expect(screen.queryByRole('button', { name: 'Needs review' })).toBeNull();
  const badge = screen.getByRole('button', detailsButton);
  expect(badge.textContent).toContain('Needs review');
  expect(screen.getAllByRole('button', detailsButton)).toHaveLength(1);
  expect(badge.tabIndex).toBe(0);
  badge.focus();
  expect(document.activeElement).toBe(badge);
  {
    fireEvent.click(badge);
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

it('repairs missing mappings and imported note destinations within Issues', () => {
  const onMapField = vi.fn();
  const onSetAssetNoteDestination = vi.fn(() => ({ changedIds: [account.id], skippedIds: [] }));
  const item = {
    ...account,
    note: { ...account.note!, publicAllowed: false },
    schemaFields: account.schemaFields!.map((field) =>
      field.key === 'secret.password'
        ? { ...field, candidates: [{ id: 'recovery', name: 'Recovery token', length: 10 }] }
        : field,
    ),
  };
  render(
    <AssetReviewQueue
      assets={[item]}
      onMapField={onMapField}
      preservation={{ coverage, noteSources: [], onSetAssetNoteDestination }}
    />,
  );
  fireEvent.click(screen.getByRole('button', detailsButton));
  const issues = within(screen.getByRole('dialog', dialogName));
  fireEvent.click(issues.getByRole('button', { name: 'Choose Password source field' }));
  fireEvent.click(issues.getByRole('button', { name: 'Map Password to Recovery token' }));
  expect(onMapField).toHaveBeenCalledWith(item, 'secret.password', 'recovery');
  const notes = issues.getByRole('radiogroup', { name: 'Notes destination for this asset' });
  expect(within(notes).queryByRole('radio', { name: /Asset notes/ })).toBeNull();
  fireEvent.click(within(notes).getByRole('radio', { name: 'As secret' }));
  expect(onSetAssetNoteDestination).toHaveBeenCalledWith(item, 'protected');
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
});

it('reports a missing required field without flagging other mapped fields as invalid', () => {
  const item = {
    ...account,
    note: undefined,
    schemaFields: [
      { key: 'secret.username', label: 'Username', sourceFieldId: 'username' },
      { key: 'secret.password', label: 'Password', required: true },
    ],
  };
  const invalidAssetCoverage = {
    ready: false,
    diagnostics: [],
    fields: [
      field('username', 'Login name', 'invalid', {
        destinations: [{ assetId: item.id, fieldId: 'secret.username', valid: false }],
      }),
    ],
  };
  render(
    <AssetReviewQueue
      assets={[item]}
      preservation={{ coverage: invalidAssetCoverage, noteSources: [] }}
    />,
  );
  fireEvent.click(screen.getByRole('button', detailsButton));
  const issues = within(screen.getByRole('dialog', dialogName));
  expect(issues.getByText('Password — Required field is missing.')).toBeTruthy();
  expect(issues.queryByText(/Username|Login name/)).toBeNull();
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
  const dialog = within(screen.getByRole('dialog', { name: 'Other account — Issues' }));
  expect(dialog.queryByText('Other asset memo')).toBeNull();
  expect(dialog.getByText('No field issues found for this asset.')).toBeTruthy();
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
  expect(dialog.getByText('Email — Invalid email')).toBeTruthy();
  expect(dialog.queryByText('Mapped · This asset · Email')).toBeNull();
  expect(dialog.queryByText(/Preserved in an additional asset/)).toBeNull();
});


it('opens parser-only warnings directly and restores Fields when actionable issues return', () => {
  const openIssuesRef = { current: undefined as (() => void) | undefined };
  const resolved = { ...account, schemaFields: [], unmapped: [], note: undefined };
  const report = { ...coverage, fields: [] };
  const details = (asset: ReviewAsset) => (
    <AssetReviewDetails asset={asset} coverage={report} sourceFields={[]}
      siblings={[]} openIssuesRef={openIssuesRef} />
  );
  const view = render(details(resolved));
  expect(screen.getByRole('button', detailsButton).textContent).toContain('Warnings (1)');
  expect(screen.queryByText('Needs review')).toBeNull();
  fireEvent.click(screen.getByRole('button', detailsButton));
  let dialog = within(screen.getByRole('dialog', { name: 'Work account — Warnings' }));
  expect(dialog.getByText('Entry attachment was skipped.')).toBeTruthy();
  expect(dialog.queryByText('Fields to resolve')).toBeNull();
  expect(dialog.queryByText('No issues found. Ready for review.')).toBeNull();
  fireEvent.click(dialog.getByRole('button', { name: 'Close Work account — Warnings' }));
  view.rerender(details(account));
  expect(screen.getByRole('button', detailsButton).textContent).toContain('Needs review');
  act(() => openIssuesRef.current?.());
  dialog = within(screen.getByRole('dialog', dialogName));
  expect(dialog.getByText('Password — Required field is missing.')).toBeTruthy();
  expect(dialog.queryByText('Entry attachment was skipped.')).toBeNull();
});
