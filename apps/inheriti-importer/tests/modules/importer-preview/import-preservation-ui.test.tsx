import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SensitiveValue } from '@modules/import/domain/import-model';
import { getAssetFieldDisplayName } from '@modules/_shared/domain/asset-field-display-name';
import type { SourceCoverage } from '@modules/mapping/application/source-coverage';
import { AssetReviewQueue, type ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';
import { ImporterFlow } from '@modules/importer-preview/ImporterFlow';
import type { ImportReviewControls } from '@modules/importer-preview/AssetReviewQueue/import-review-controls';
import { NotesField } from '@modules/importer-preview/AssetReviewQueue/components/NotesField';
import { ImportCoverage } from '@modules/importer-preview/AssetReviewQueue/components/ImportCoverage';

afterEach(cleanup);

const noteChoice = (group: string, name: string) =>
  within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name });

it.each([
  ['asset-notes', 'Asset notes'],
  ['protected', 'As secret'],
] as const)(
  'marks the inherited %s destination and allows an asset override',
  (destination, label) => {
    const onSetNoteDestination = vi.fn(() => ({ changedIds: ['account'], skippedIds: [] }));
    const group = 'Notes destination for this asset';
    const { rerender } = render(
      <NotesField asset={account} onSetNoteDestination={onSetNoteDestination} />,
    );
    expect((noteChoice(group, label) as HTMLInputElement).checked).toBe(false);
    const inherited: ReviewAsset = {
      ...account,
      note: { ...account.note!, destination, explicit: true, inherited: true },
    };
    rerender(<NotesField asset={inherited} onSetNoteDestination={onSetNoteDestination} />);
    expect((noteChoice(group, label) as HTMLInputElement).checked).toBe(true);
    expect(onSetNoteDestination).not.toHaveBeenCalled();
    fireEvent.click(noteChoice(group, label));
    expect(onSetNoteDestination).toHaveBeenCalledExactlyOnceWith(inherited, destination);
    onSetNoteDestination.mockClear();
    const override = destination === 'asset-notes' ? 'protected' : 'asset-notes';
    fireEvent.click(noteChoice(group, override === 'protected' ? 'As secret' : 'Asset notes'));
    expect(onSetNoteDestination).toHaveBeenCalledExactlyOnceWith(inherited, override);
    rerender(
      <NotesField
        asset={{
          ...inherited,
          note: { ...inherited.note!, destination: override, inherited: false },
        }}
        onSetNoteDestination={onSetNoteDestination}
      />,
    );
    expect(
      (
        noteChoice(
          group,
          override === 'protected' ? 'As secret' : 'Asset notes',
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
  },
);

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
      name: 'extra:Comment',
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

it.each(['suggested', 'accepted'] as const)(
  'opens the exact %s protected notes destination from the source tree',
  (status) => {
    const original = {
      ...account,
      folderPath: ['Accounts'],
      note: { ...account.note!, explicit: true },
    };
    const destination: ReviewAsset = {
      ...account,
      id: 'companion',
      type: 'PLAIN-TEXT',
      name: 'Protected copy',
      status,
      folderPath: ['Accounts'],
      note: undefined,
      plainTextSources: [{ id: 'native-note', name: 'Notes' }],
      schemaFields: [{ key: 'secret.text', label: 'Plain text' }],
    };
    const onSelect = vi.fn();
    const resolveSourceValue = vi.fn(() => new SensitiveValue('synthetic-note'));
    const { container } = render(
      <AssetReviewQueue
        assets={[
          original,
          { ...destination, id: 'different-entry', sourceNodeId: 'other-entry' },
          { ...destination, id: 'different-source', sourceId: 'bravo' },
          {
            ...destination,
            id: 'same-entry-wrong-binding',
            plainTextSources: [{ id: 'other-field', name: 'Notes' }],
          },
          destination,
        ]}
        sourceFiles={files}
        onSelect={onSelect}
        onReviewAssets={vi.fn()}
        resolveSourceValue={resolveSourceValue}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Accepted/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Tree' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search assets' }));
    const search = screen.getByRole('textbox', { name: 'Search assets' }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'Account' } });
    expect(container.querySelector('[data-review-asset-id="companion"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText('1 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Protected copy' }));

    expect(screen.getByRole('button', { name: 'All 5' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('1 selected')).toBeNull();
    expect(onSelect).toHaveBeenLastCalledWith(destination);
    expect(search.value).toBe('');
    const destinationRow = container.querySelector('[data-review-asset-id="companion"]');
    expect(destinationRow?.contains(document.activeElement)).toBe(true);
    const inspector = container.querySelector('.asset-review-inspector') as HTMLElement;
    expect(within(inspector).getByText('Protected copy')).toBeTruthy();
    expect(within(inspector).getByRole('textbox', { name: 'Plain text value' })).toBeTruthy();
    expect(screen.queryByText('synthetic-note')).toBeNull();
    expect(resolveSourceValue).not.toHaveBeenCalled();
  },
);

it('explains when a protected note is stored in the same asset', () => {
  const resolveSourceValue = vi.fn(() => new SensitiveValue('synthetic-note'));
  const noteAsset: ReviewAsset = {
    ...account,
    type: 'PLAIN-TEXT',
    schemaFields: [{ key: 'secret.text', sourceFieldId: 'native-note', label: 'Plain text' }],
  };
  render(<NotesField asset={noteAsset} resolveSourceValue={resolveSourceValue} />);
  expect(screen.getByText('These notes are stored in this asset’s secret.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Open/ })).toBeNull();
  expect(resolveSourceValue).not.toHaveBeenCalled();
});

it('shows mixed effective note destinations while retaining the source choice', () => {
  const onSetSourceNoteDestination = vi.fn();
  const inherited = { ...account.note!, explicit: true, inherited: true };
  const override = {
    ...inherited,
    sourceFieldId: 'override-note',
    destination: 'asset-notes' as const,
    inherited: false,
  };
  render(
    <AssetReviewQueue
      assets={[
        { ...account, note: inherited },
        { ...account, id: 'override', sourceNodeId: 'override-entry', note: override },
      ]}
      sourceFiles={files}
      preservation={{
        ...preservation,
        noteSources: [
          { sourceId: 'alpha', sourceName: 'Alpha.1pux', fieldCount: 2, destination: 'protected' },
        ],
        onSetSourceNoteDestination,
      }}
    />,
  );
  const trigger = screen.getByRole('button', { name: 'Notes destination', exact: true });
  expect(trigger.textContent).toContain('Mixed');
  const help = screen.getByLabelText('About Asset notes').parentElement!;
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.focus(help);
  expect(screen.getByRole('tooltip').textContent).toContain(
    'Asset notes are visible in plan details without revealing secrets.',
  );
  fireEvent.blur(help);
  fireEvent.click(trigger);
  expect(
    within(screen.getByRole('dialog', { name: 'Choose notes destination' })).getByText(
      'Asset notes are visible in plan details without revealing secrets.',
    ),
  ).toBeTruthy();
  expect(
    (noteChoice('Notes destination · All sources · 2 fields', 'As secret') as HTMLInputElement)
      .checked,
  ).toBe(true);
  expect(onSetSourceNoteDestination).not.toHaveBeenCalled();
});

it('reports the protected destination of an organized native note without a note control', () => {
  render(
    <AssetReviewQueue
      assets={[{ ...account, note: undefined }]}
      sourceFiles={files}
      preservation={{
        ...preservation,
        coverage: {
          ...preservation.coverage,
          fields: [
            {
              id: 'native-note',
              name: 'notes',
              sourceId: 'alpha',
              nodeId: 'entry',
              status: 'protected',
              destinations: [{ assetId: account.id, fieldId: 'secret.text', valid: true }],
            },
          ],
        },
        noteSources: [
          {
            sourceId: 'alpha',
            sourceName: 'Alpha.1pux',
            destination: 'asset-notes',
            fieldCount: 1,
            fieldIds: ['native-note'],
          },
        ],
        onSetSourceNoteDestination: vi.fn(() => ({ changedIds: [], skippedIds: [] })),
      }}
    />,
  );
  const trigger = screen.getByRole('button', { name: 'Notes destination' });
  expect(trigger.textContent).toContain('As secret');
  fireEvent.click(trigger);
  expect(
    (noteChoice('Notes destination · All sources · 1 field', 'Asset notes') as HTMLInputElement)
      .checked,
  ).toBe(true);
});

it('scopes the bulk notes choice and keeps protected contents out of the original Notes block', () => {
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
  const trigger = screen.getByRole('button', { name: 'Notes destination', exact: true });
  expect(trigger.textContent).toContain('Needs destination');
  expect(screen.queryByRole('dialog', { name: 'Choose notes destination' })).toBeNull();
  fireEvent.click(trigger);
  expect(document.activeElement).toBe(
    noteChoice('Notes destination · All sources · 3 fields', 'Asset notes'),
  );
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Choose notes destination' })).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.click(noteChoice('Notes destination · All sources · 3 fields', 'Asset notes'));
  expect(onSetSourceNoteDestination).toHaveBeenLastCalledWith(null, 'asset-notes');
  expect(screen.getByText(/1 note skipped/)).toBeTruthy();
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole('dialog', { name: 'Choose notes destination' })).toBeNull();
  fireEvent.click(trigger);
  fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'alpha' } });
  expect(screen.queryByRole('dialog', { name: 'Choose notes destination' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Notes destination', exact: true }));
  fireEvent.click(noteChoice('Notes destination · Alpha.1pux · 1 field', 'As secret'));
  expect(onSetSourceNoteDestination).toHaveBeenLastCalledWith('alpha', 'protected');
  fireEvent.click(noteChoice('Notes destination for this asset', 'Asset notes'));
  expect(onSetAssetNoteDestination).toHaveBeenCalledWith(account, 'asset-notes');
  expect(screen.getByText('Choose a destination for these protected notes.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Reveal Notes or guidelines value' })).toBeNull();
  expect(screen.queryByText('synthetic-note')).toBeNull();
  expect(resolveSourceValue).not.toHaveBeenCalled();

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
  expect(
    screen.getByRole('button', { name: 'Notes destination', exact: true }).textContent,
  ).toContain('As secret');
  expect(screen.getByText(/Current destination: As secret/)).toBeTruthy();
  const inheritedChoice = noteChoice(
    'Notes destination for this asset',
    'As secret',
  ) as HTMLInputElement;
  expect(inheritedChoice.checked).toBe(true);
  fireEvent.click(noteChoice('Notes destination for this asset', 'Asset notes'));
  expect(onSetAssetNoteDestination).toHaveBeenLastCalledWith(inherited, 'asset-notes');

  for (const [otherDestination, status] of [
    ['asset-notes', 'As secret'],
    ['protected', 'As secret'],
  ] as const) {
    rerender(
      <AssetReviewQueue
        assets={[inherited]}
        sourceFiles={files}
        resolveSourceValue={resolveSourceValue}
        preservation={{
          ...controls,
          noteSources: controls.noteSources.map((entry) => ({
            ...entry,
            destination: entry.sourceId === 'alpha' ? 'protected' : otherDestination,
          })),
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'all' } });
    expect(
      screen.getByRole('button', { name: 'Notes destination', exact: true }).textContent,
    ).toContain(status);
  }

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
    within(
      screen.getByRole('radiogroup', { name: 'Notes destination for this asset' }),
    ).queryByRole('radio', {
      name: /Asset notes/,
    }),
  ).toBeNull();
  expect(screen.getByText(note.reason)).toBeTruthy();
});

it('reports coverage including diagnostics for files with no assets and resolves selected fields', () => {
  const onExcludeFields = vi.fn(() => ({ changedIds: ['comment'], skippedIds: [] }));
  render(
    <AssetReviewQueue
      assets={[account]}
      sourceFiles={files}
      preservation={{ ...preservation, onExcludeFields }}
    />,
  );
  for (const label of ['2 mapped', '1 excluded', '2 unassigned', '2 unsupported']) {
    expect(screen.getByText(label)).toBeTruthy();
  }
  fireEvent.click(screen.getByRole('button', { name: 'View source field details' }));
  const details = within(screen.getByRole('dialog', { name: 'Source field details' }));
  fireEvent.click(details.getByRole('button', { name: 'Show All fields' }));
  expect(details.getByText('Attachments are unsupported.')).toBeTruthy();
  expect(details.getByText('Bravo.kdbx · 2 found')).toBeTruthy();
  expect(details.getByText('Unsupported')).toBeTruthy();
  expect(details.queryByRole('button', { name: 'Done' })).toBeNull();
  expect(details.queryByRole('button', { name: 'Show Protected fields' })).toBeNull();
  fireEvent.click(details.getByRole('button', { name: 'Show Mapped fields' }));
  expect(details.getByText('Username')).toBeTruthy();
  expect(details.getByText('Notes')).toBeTruthy();
  expect(details.getAllByText('Mapped', { exact: true })).toHaveLength(3);
  expect(details.queryByRole('checkbox')).toBeNull();
  fireEvent.click(details.getByRole('button', { name: 'Show Invalid fields' }));
  expect(details.getByText('No source fields match this filter.')).toBeTruthy();
  const pendingTab = details.getByRole('button', { name: 'Show Unassigned fields' });
  fireEvent.click(pendingTab);
  expect(pendingTab.getAttribute('aria-pressed')).toBe('true');
  expect(details.queryByText('Attachments are unsupported.')).toBeNull();
  expect(details.queryByText('extra:Comment')).toBeNull();
  fireEvent.click(details.getByRole('checkbox', { name: 'Comment from Alpha.1pux' }));
  expect(details.getByText('1 selected')).toBeTruthy();
  fireEvent.click(details.getByRole('button', { name: 'Clear' }));
  expect(details.queryByText('1 selected')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Comment from Alpha.1pux' }));
  fireEvent.click(screen.getByRole('button', { name: 'Exclude fields' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onExcludeFields).not.toHaveBeenCalled();
  expect(details.getByText('1 selected')).toBeTruthy();
  fireEvent.click(details.getByRole('button', { name: 'Exclude fields' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm exclusion' }));
  expect(onExcludeFields).toHaveBeenCalledWith(['comment']);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(within(screen.getByRole('status')).getByText('1 excluded')).toBeTruthy();
});

it('filters a chosen asset Notes destination out of Unassigned before acceptance', () => {
  const { note } = account;
  const noteCoverage: SourceCoverage = {
    diagnostics: [],
    ready: false,
    fields: [
      {
        id: note!.sourceFieldId,
        name: 'Native notes',
        sourceId: 'alpha',
        nodeId: 'entry',
        status: 'pending',
        destinations: [],
      },
    ],
  };
  const queue = (explicit: boolean) => (
    <ImportCoverage
      coverage={noteCoverage}
      sourceNames={new Map([['alpha', 'Alpha.1pux']])}
      assetNames={new Map()}
      reviewAssets={[
        {
          ...account,
          status: 'suggested',
          note: { ...note!, destination: 'asset-notes', explicit },
        },
      ]}
      onExcludeFields={vi.fn()}
    />
  );
  const { rerender } = render(queue(false));
  fireEvent.click(screen.getByRole('button', { name: 'View source field details' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Source field details' }));
  fireEvent.click(dialog.getByRole('button', { name: 'Show Unassigned fields' }));
  expect(dialog.getByText('Native notes')).toBeTruthy();
  rerender(queue(true));
  expect(dialog.queryByText('Native notes')).toBeNull();
  fireEvent.click(dialog.getByRole('button', { name: 'Show Proposed fields' }));
  expect(dialog.getByText('Native notes')).toBeTruthy();
  expect(
    dialog.getByTitle(`Proposed in Account · ${getAssetFieldDisplayName('meta.notes')}`),
  ).toBeTruthy();
});

it('scopes source detail counts, pagination, selections, and bulk actions by file ID', () => {
  const alphaFields = Array.from({ length: 21 }, (_, index) => ({
    id: `alpha-${index}`,
    name: index === 0 ? 'Shared field' : `Alpha field ${index}`,
    sourceId: 'alpha',
    nodeId: 'entry',
    status: 'pending' as const,
    destinations: [],
  }));
  const betaFields = [
    { ...alphaFields[0]!, id: 'beta-0', sourceId: 'beta' },
    {
      ...alphaFields[0]!,
      id: 'beta-1',
      sourceId: 'beta',
      name: 'Beta invalid',
      status: 'invalid' as const,
    },
  ];
  const onExcludeFields = vi.fn(() => ({ changedIds: ['beta-1'], skippedIds: [] }));
  const queue = (fields: SourceCoverage['fields'], includeParserOnly = true) => (
    <ImportCoverage
      coverage={{
        fields,
        ready: false,
        diagnostics: [
          {
            sourceId: 'alpha',
            code: 'alpha-warning',
            kind: 'unsupported',
            message: 'Alpha warning',
            count: 1,
          },
          ...(includeParserOnly
            ? [
                {
                  sourceId: 'diagnostic-only',
                  code: 'source-warning',
                  kind: 'unsupported' as const,
                  message: 'Parser-only source warning',
                  count: 1,
                },
              ]
            : []),
          {
            sourceId: '',
            code: 'unknown-warning',
            kind: 'skipped',
            message: 'Unknown source warning',
            count: 1,
          },
        ],
      }}
      sourceNames={
        new Map([
          ['alpha', 'duplicate.csv'],
          ['beta', 'duplicate.csv'],
        ])
      }
      assetNames={new Map()}
      reviewAssets={[]}
      onExcludeFields={onExcludeFields}
    />
  );
  const { rerender } = render(queue([...alphaFields, ...betaFields]));
  fireEvent.click(screen.getByRole('button', { name: 'View source field details' }));
  let dialog = within(screen.getByRole('dialog', { name: 'Source field details' }));
  fireEvent.click(dialog.getByRole('button', { name: 'Show All fields' }));
  const sources = () =>
    within(dialog.getByRole('group', { name: 'Filter source field details by source' }));
  expect(sources().getByRole('button', { name: 'All sources' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(sources().getByRole('button', { name: 'duplicate.csv (2)' })).toBeTruthy();
  fireEvent.click(sources().getByRole('button', { name: 'duplicate.csv', exact: true }));
  expect(dialog.queryByText('Parser-only source warning')).toBeNull();
  fireEvent.click(dialog.getByRole('checkbox', { name: 'Select all 21 fields in this filter' }));
  expect(dialog.getByText('21 selected')).toBeTruthy();
  fireEvent.click(dialog.getByRole('button', { name: 'More fields' }));
  expect(dialog.getByText('Alpha field 20')).toBeTruthy();

  fireEvent.click(sources().getByRole('button', { name: 'duplicate.csv (2)' }));
  expect(dialog.getByRole('button', { name: 'Show Unassigned fields' }).textContent).toBe(
    'Unassigned1',
  );
  expect(dialog.getByRole('button', { name: 'Show Invalid fields' }).textContent).toBe('Invalid1');
  expect(
    dialog.getByRole('button', { name: 'Previous fields' }).getAttribute('aria-disabled'),
  ).toBe('true');
  expect(dialog.queryByText('21 selected')).toBeNull();
  expect(dialog.queryByText('Alpha warning')).toBeNull();
  expect(dialog.getByText('Unknown source warning')).toBeTruthy();
  expect(
    dialog.getByRole('checkbox', { name: 'Shared field from duplicate.csv (2)' }),
  ).toBeTruthy();
  expect(dialog.getByRole('button', { name: 'Exclude fields' }).getAttribute('aria-disabled')).toBe(
    'true',
  );
  rerender(queue([...alphaFields, { ...betaFields[0]!, status: 'protected' }, betaFields[1]!]));
  fireEvent.click(dialog.getByRole('checkbox', { name: 'Beta invalid from duplicate.csv (2)' }));
  fireEvent.click(dialog.getByRole('button', { name: 'Exclude fields' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm exclusion' }));
  expect(onExcludeFields).toHaveBeenCalledWith(['beta-1']);
  expect(screen.queryByRole('dialog')).toBeNull();
  const resolvedFields: SourceCoverage['fields'] = [
    ...alphaFields,
    { ...betaFields[0]!, status: 'protected' },
    { ...betaFields[1]!, status: 'excluded' },
  ];
  rerender(queue(resolvedFields));
  fireEvent.click(screen.getByRole('button', { name: 'View source field details' }));
  dialog = within(screen.getByRole('dialog', { name: 'Source field details' }));
  fireEvent.click(dialog.getByRole('button', { name: 'Show All fields' }));
  fireEvent.click(sources().getByRole('button', { name: 'duplicate.csv (2)' }));
  expect(dialog.getByRole('button', { name: 'Show Excluded fields' }).textContent).toBe(
    'Excluded1',
  );
  expect(dialog.getByRole('button', { name: 'Exclude fields' }).getAttribute('aria-disabled')).toBe(
    'true',
  );

  fireEvent.click(sources().getByRole('button', { name: 'Source' }));
  expect(dialog.getByText('Parser-only source warning')).toBeTruthy();
  expect(dialog.queryByText('Alpha warning')).toBeNull();
  expect(dialog.getByText('Unknown source warning')).toBeTruthy();
  expect(dialog.getByRole('button', { name: 'Show All fields' }).textContent).toBe('All2');
  rerender(queue(resolvedFields, false));
  expect(sources().getByRole('button', { name: 'All sources' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(dialog.getByRole('button', { name: 'Show Unassigned fields' }).textContent).toBe(
    'Unassigned21',
  );
  expect(dialog.getByText('Alpha warning')).toBeTruthy();
  expect(
    dialog.getByRole('checkbox', { name: 'Select all 21 fields in this filter' }),
  ).toBeTruthy();
});

const acceptedReviewFlow = {
  files,
  assets: [
    { ...account, note: { ...account.note!, explicit: true } },
    {
      ...account,
      id: 'second',
      note: {
        ...account.note!,
        sourceFieldId: 'second-note',
        explicit: true,
        destination: 'asset-notes' as const,
      },
    },
  ],
  unassigned: [],
  plans: [],
  checklist: [],
  callbacks: {},
  initialStage: 'assets' as const,
};

const reviewPreservation = {
  ...preservation,
  onSetSourceNoteDestination: vi.fn(),
};

it('routes accepted assets to the exact pending fields blocking Continue', () => {
  const { rerender } = render(
    <ImporterFlow {...acceptedReviewFlow} preservation={reviewPreservation} />,
  );
  const next = screen.getByRole('button', { name: 'Continue' });
  expect(next.getAttribute('aria-disabled')).toBe('true');
  expect(screen.getByText('Mixed')).toBeTruthy();
  expect(screen.getByText('2 fields need a destination')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Resolve notes' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Resolve fields' }));
  const details = within(screen.getByRole('dialog', { name: 'Source field details' }));
  expect(
    details.getByRole('button', { name: 'Show Unassigned fields' }).getAttribute('aria-pressed'),
  ).toBe('true');
  fireEvent.click(details.getByRole('button', { name: 'Close Source field details' }));

  rerender(
    <ImporterFlow
      {...acceptedReviewFlow}
      preservation={{
        ...reviewPreservation,
        coverage: {
          ...coverage,
          fields: coverage.fields.filter(({ status }) => status !== 'pending'),
          ready: true,
        },
      }}
    />,
  );
  expect(next.getAttribute('aria-disabled')).not.toBe('true');
  expect(screen.queryByRole('button', { name: 'Resolve fields' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Resolve notes' })).toBeNull();
});

it('identifies a pending notes destination separately from pending fields', () => {
  render(
    <ImporterFlow
      {...acceptedReviewFlow}
      assets={[account]}
      preservation={{
        ...reviewPreservation,
        coverage: {
          ...coverage,
          fields: [
            {
              id: account.note!.sourceFieldId,
              name: 'Notes',
              sourceId: account.sourceId!,
              nodeId: account.sourceNodeId!,
              status: 'pending',
              destinations: [],
            },
          ],
        },
      }}
    />,
  );
  expect(screen.getByRole('button', { name: 'Continue' }).getAttribute('aria-disabled')).toBe(
    'true',
  );
  expect(screen.getByText('1 note needs a destination')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Resolve notes' }));
  expect(screen.getByRole('dialog', { name: 'Choose notes destination' })).toBeTruthy();
  expect(screen.queryByText('1 field needs a destination')).toBeNull();
});

it('enables Continue without opening warnings on a processed source with zero assets', () => {
  const props = { assets: [], unassigned: [], plans: [], checklist: [], callbacks: {} };
  const source = {
    ...files[1]!,
    status: 'warning' as const,
    diagnostics: coverage.diagnostics,
    entries: 0,
  };
  render(<ImporterFlow {...props} files={[source]} />);
  expect(screen.getByRole('button', { name: 'Continue' }).getAttribute('aria-disabled')).not.toBe(
    'true',
  );
});

it('selects across pages, scopes Select All to the filter, and prunes resolved fields', () => {
  const pendingFields = Array.from({ length: 22 }, (_, index) => ({
    id: `pending-${index}`,
    name: `Field ${index}`,
    sourceId: 'alpha',
    nodeId: 'entry',
    status: 'pending' as const,
    destinations: [],
  }));
  const invalid = {
    ...pendingFields[0]!,
    id: 'invalid',
    name: 'Invalid field',
    status: 'invalid' as const,
  };
  const onExcludeFields = vi.fn(() => ({ changedIds: [], skippedIds: [] }));
  const queue = (resolved = false) => (
    <AssetReviewQueue
      assets={[account]}
      sourceFiles={files}
      preservation={{
        ...preservation,
        onExcludeFields,
        coverage: {
          ...coverage,
          diagnostics: [],
          fields: [
            ...pendingFields.map((field, index) =>
              resolved && index === 0 ? { ...field, status: 'excluded' as const } : field,
            ),
            invalid,
          ],
        },
      }}
    />
  );
  const { rerender } = render(queue());
  fireEvent.click(screen.getByRole('button', { name: 'View source field details' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Source field details' }));
  fireEvent.click(dialog.getByRole('button', { name: 'Show Invalid fields' }));
  fireEvent.click(dialog.getByRole('checkbox', { name: 'Invalid field from Alpha.1pux' }));
  fireEvent.click(dialog.getByRole('button', { name: 'Show Unassigned fields' }));
  fireEvent.click(dialog.getByText('Field 0'));
  expect(dialog.getByText('1 selected')).toBeTruthy();
  fireEvent.click(dialog.getByText('Field 0'), { ctrlKey: true });
  fireEvent.click(dialog.getByText('Field 2'), { shiftKey: true });
  expect(dialog.getByText('4 selected')).toBeTruthy();
  const selectAll = dialog.getByRole('checkbox', { name: 'Select all 22 fields in this filter' });
  expect(selectAll.getAttribute('aria-checked')).toBe('mixed');
  fireEvent.keyDown(selectAll, { key: 'a', metaKey: true });
  expect(dialog.getByText('23 selected')).toBeTruthy();
  fireEvent.click(selectAll);
  expect(dialog.getByText('1 selected')).toBeTruthy();
  fireEvent.click(selectAll);
  fireEvent.click(dialog.getByRole('button', { name: 'More fields' }));
  expect(
    (dialog.getByRole('checkbox', { name: 'Field 21 from Alpha.1pux' }) as HTMLInputElement)
      .checked,
  ).toBe(true);

  rerender(queue(true));
  expect(dialog.getByText('22 selected')).toBeTruthy();
  rerender(queue());
  expect(dialog.getByText('22 selected')).toBeTruthy();
  fireEvent.click(dialog.getByRole('button', { name: 'Exclude fields' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm exclusion' }));
  expect(onExcludeFields).toHaveBeenCalledWith([
    ...pendingFields.slice(1).map(({ id }) => id),
    'invalid',
  ]);
  expect(dialog.getByText('0 excluded · 0 skipped')).toBeTruthy();

  const nextPageField = dialog.getByRole('checkbox', { name: 'Field 21 from Alpha.1pux' });
  fireEvent.click(nextPageField);
  fireEvent.keyDown(nextPageField, { key: 'Escape' });
  expect(dialog.queryByText('1 selected')).toBeNull();
  fireEvent.keyDown(nextPageField, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('supports margin drag and Ctrl-drag without selecting readonly coverage rows', () => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  try {
    const onExcludeFields = vi.fn(() => ({ changedIds: [], skippedIds: [] }));
    render(
      <AssetReviewQueue
        assets={[account]}
        sourceFiles={files}
        preservation={{ ...preservation, onExcludeFields }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'View source field details' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Source field details' }));
    const list = dialog.getByRole('region', { name: 'Source field details' });
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
    } as DOMRect);
    for (const [index, row] of Array.from(
      list.querySelectorAll('[data-coverage-field-id]'),
    ).entries()) {
      vi.spyOn(row, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
      vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
        left: 10,
        top: 10 + index * 30,
        right: 95,
        bottom: 35 + index * 30,
      } as DOMRect);
    }
    fireEvent.pointerDown(list, { pointerType: 'mouse', button: 0, clientX: 1, clientY: 1 });
    fireEvent.pointerMove(document, { clientX: 95, clientY: 32 });
    fireEvent.pointerUp(document);
    expect(dialog.getByText('1 selected')).toBeTruthy();
    const comment = dialog.getByText('Comment');
    fireEvent.pointerDown(comment, {
      pointerType: 'mouse',
      button: 0,
      ctrlKey: true,
      clientX: 20,
      clientY: 45,
    });
    fireEvent.pointerMove(document, { clientX: 95, clientY: 100 });
    fireEvent.pointerUp(document);
    fireEvent.click(comment, { ctrlKey: true });
    expect(dialog.getByText('2 selected')).toBeTruthy();
    expect(dialog.queryByRole('checkbox', { name: 'Username from Alpha.1pux' })).toBeNull();
    fireEvent.click(dialog.getByRole('button', { name: 'Exclude fields' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm exclusion' }));
    expect(onExcludeFields).toHaveBeenCalledWith(['otp', 'comment']);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('keeps the source filter visible with a single imported source', () => {
  render(
    <ImportCoverage
      coverage={{
        fields: [
          {
            id: 'single-field',
            name: 'Username',
            sourceId: 'alpha',
            nodeId: 'entry',
            status: 'pending',
            destinations: [],
          },
        ],
        diagnostics: [],
        ready: false,
      }}
      sourceNames={new Map([['alpha', 'Vault.yaml']])}
      assetNames={new Map()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'View source field details' }));
  const sources = within(
    screen.getByRole('group', { name: 'Filter source field details by source' }),
  );
  fireEvent.click(sources.getByRole('button', { name: 'Vault.yaml' }));
  expect(sources.getByRole('button', { name: 'Vault.yaml' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  fireEvent.click(sources.getByRole('button', { name: 'All sources' }));
  expect(sources.getByRole('button', { name: 'All sources' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
});
