// @vitest-environment happy-dom
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createEmptyImportSession, SensitiveValue } from '@modules/import/domain/import-model';
import { AssetReviewQueue, type ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';
import type {
  FieldOperationPreview,
  FieldOperationRequest,
} from '@modules/importer-preview/AssetReviewQueue/field-operations';
import { FieldOperationModal } from '@modules/importer-preview/AssetReviewQueue/components/FieldOperationModal';
import { useImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/importer-workspace';
import { createEmptyWorkspace } from '@modules/plans/domain/workspace-model';
import type { SourceCoverage } from '@modules/mapping/application/source-coverage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const origin: ReviewAsset = {
  id: 'origin',
  type: 'USER-PSWD',
  name: 'Primary account',
  source: 'Synthetic vault',
  sourceId: 'file',
  sourceNodeId: 'entry',
  status: 'needs-review',
  rationale: '',
  alternatives: [],
  mapped: ['Username'],
  unmapped: ['Recovery', 'Recovery', 'Device'],
  unmappedSourceFieldIds: ['r1', 'device', 'r2'],
  schemaFields: [
    { key: 'secret.username', label: 'Username', sourceFieldId: 'user' },
    { key: 'secret.password', label: 'Password', required: true },
  ],
};
const created: ReviewAsset = {
  ...origin,
  id: 'created',
  name: 'New protected asset',
  type: 'PLAIN-TEXT',
};
const coverage: SourceCoverage = {
  diagnostics: [],
  ready: false,
  fields: [
    { id: 'user', name: 'Username', status: 'pending' },
    { id: 'r1', name: 'Recovery', status: 'pending' },
    { id: 'device', name: 'Device', status: 'pending' },
    { id: 'r2', name: 'Recovery', status: 'pending' },
    { id: 'excluded', name: 'Excluded', status: 'excluded' },
    { id: 'foreign', name: 'Recovery', sourceId: 'other', status: 'pending' },
  ].map((field) => ({
    sourceId: 'file',
    nodeId: 'entry',
    destinations: [],
    ...field,
  })) as SourceCoverage['fields'],
};

function makePreview(request: FieldOperationRequest): FieldOperationPreview {
  const operationId = 'operation';
  const groups = request.groups ?? [
    {
      id: 'entry:ASSET-operation-0',
      nodeId: 'entry',
      name: 'Preview group',
      type: 'PLAIN-TEXT',
      fieldBindings: { 'secret.text': request.fieldIds },
    },
  ];
  const canConfirm = groups.every(
    ({ name, fieldBindings }) => name.trim() && Object.keys(fieldBindings).length,
  );
  return {
    request: { ...request, operationId },
    token: Symbol(),
    assets: [],
    groups,
    errors: canConfirm ? [] : ['Complete each destination’s field mapping before confirming.'],
    canConfirm,
    affectedEntryCount: request.repeatCompatible ? 3 : 1,
    compatibleEntryCount: request.repeatCompatible ? 3 : 1,
    skippedEntryCount: 2,
    movedFieldCount: 1,
    remainingFieldCount: 1,
  };
}
const updated = {
  success: true,
  message: 'Fields organized.',
  createdAssetIds: [created.id],
  changedAssetIds: [origin.id],
};
const restored = {
  success: true,
  message: 'Fields restored.',
  createdAssetIds: [],
  changedAssetIds: [origin.id],
};
const controls = () => ({
  preview: vi.fn(makePreview),
  commit: vi.fn(() => updated),
  undo: vi.fn(() => restored),
  canUndo: false,
  assetTypes: ['PLAIN-TEXT', 'API-KEY'],
  schemaFields: (type: string) =>
    type === 'API-KEY' ? [{ key: 'secret.apiKey', label: 'API key', required: true }] : [],
});
const openFields = () => {
  fireEvent.click(screen.getByRole('button', { name: 'View asset issues' }));
  return within(screen.getByRole('dialog', { name: /— Issues$/ }));
};

it('selects exact local IDs by checkbox and modifier range while blocking asset shortcuts', () => {
  const fieldOperations = controls();
  const onAction = vi.fn();
  const onAcceptAllEligible = vi.fn();
  const resolveSourceValue = vi.fn();
  render(
    <AssetReviewQueue
      assets={[origin]}
      onAction={onAction}
      onAcceptAllEligible={onAcceptAllEligible}
      resolveSourceValue={resolveSourceValue}
      preservation={{ coverage, noteSources: [], fieldOperations }}
    />,
  );
  expect(screen.getByText('Password *')).toBeTruthy();
  expect(screen.queryByText('Recovery')).toBeNull();
  const fields = openFields();
  expect(fields.getByRole('heading', { name: 'Fields to resolve' })).toBeTruthy();
  expect(fields.getByText(/These fields are still available in this import/)).toBeTruthy();
  expect(fields.queryByRole('button', { name: 'Exclude fields' })).toBeNull();
  expect(fields.getAllByRole('checkbox', { name: 'Select Recovery' })).toHaveLength(2);
  expect(fields.queryByRole('checkbox', { name: 'Select Username' })).toBeNull();
  expect(fields.queryByRole('checkbox', { name: 'Select Excluded' })).toBeNull();
  fireEvent.click(fields.getAllByText('Recovery')[0], { metaKey: true });
  fireEvent.click(fields.getAllByRole('checkbox', { name: 'Select Recovery' })[1], {
    shiftKey: true,
  });
  expect(fields.getByText('3 selected')).toBeTruthy();
  fireEvent.click(fields.getByText('Device'), { ctrlKey: true });
  expect(fields.getByText('2 selected')).toBeTruthy();
  fireEvent.keyDown(document.body, { key: 'x' });
  fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true, shiftKey: true });
  expect(onAction).not.toHaveBeenCalled();
  expect(onAcceptAllEligible).not.toHaveBeenCalled();
  fireEvent.click(fields.getByRole('button', { name: 'Create assets' }));
  expect(fieldOperations.preview).toHaveBeenLastCalledWith(
    expect.objectContaining({ fieldIds: ['r1', 'r2'] }),
  );
  fireEvent.keyDown(document.body, { key: 'a' });
  expect(onAction).not.toHaveBeenCalled();
  expect(resolveSourceValue).not.toHaveBeenCalled();
});

it('confirms exclusion of selected fields from this entry and reports skipped fields', () => {
  const onExcludeFields = vi
    .fn<(ids: string[]) => { changedIds: string[]; skippedIds: string[] }>()
    .mockReturnValueOnce({ changedIds: [], skippedIds: ['r1', 'r2'] })
    .mockReturnValueOnce({ changedIds: ['r1'], skippedIds: ['r2'] });
  function Queue() {
    const [currentCoverage, setCoverage] = useState(coverage);
    return (
      <AssetReviewQueue
        assets={[origin]}
        preservation={{
          coverage: currentCoverage,
          noteSources: [],
          fieldOperations: controls(),
          onExcludeFields: (ids) => {
            const result = onExcludeFields(ids);
            setCoverage((current) => ({
              ...current,
              fields: current.fields.map((field) =>
                result.changedIds.includes(field.id) ? { ...field, status: 'excluded' } : field,
              ),
            }));
            return result;
          },
        }}
      />
    );
  }
  render(<Queue />);
  const issues = openFields();
  const exclude = () => issues.getByRole('button', { name: 'Exclude fields' });
  const confirm = () => {
    fireEvent.click(exclude());
    return within(screen.getByRole('dialog', { name: 'Exclude 2 unresolved fields?' }));
  };
  expect(exclude().hasAttribute('disabled')).toBe(true);
  for (const checkbox of issues.getAllByRole('checkbox', { name: 'Select Recovery' })) {
    fireEvent.click(checkbox);
  }
  fireEvent.click(confirm().getByRole('button', { name: 'Cancel' }));
  expect(onExcludeFields).not.toHaveBeenCalled();
  expect(issues.getByText('2 selected')).toBeTruthy();

  fireEvent.click(confirm().getByRole('button', { name: 'Confirm exclusion' }));
  expect(onExcludeFields).toHaveBeenNthCalledWith(1, ['r1', 'r2']);
  expect(issues.getByText('0 excluded · 2 skipped')).toBeTruthy();
  expect(issues.getByText('2 selected')).toBeTruthy();

  fireEvent.click(confirm().getByRole('button', { name: 'Confirm exclusion' }));
  expect(onExcludeFields).toHaveBeenNthCalledWith(2, ['r1', 'r2']);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText('1 excluded · 1 skipped')).toBeTruthy();
  const reopened = openFields();
  expect(reopened.getByText('0 selected')).toBeTruthy();
  expect(reopened.getByRole('button', { name: 'Exclude fields' }).hasAttribute('disabled')).toBe(
    true,
  );
  expect(reopened.getAllByRole('checkbox', { name: 'Select Recovery' })).toHaveLength(1);
  expect(reopened.getByRole('checkbox', { name: 'Select Device' })).toBeTruthy();
});

it('selects only visible actionable fields by aisle drag and Ctrl-drag inside the popover', () => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  render(
    <AssetReviewQueue
      assets={[origin]}
      preservation={{ coverage, noteSources: [], fieldOperations: controls() }}
    />,
  );
  const fields = openFields();
  const panel = fields.getByText('Device').closest('.asset-source-fields-list')!;
  vi.spyOn(
    panel.closest('.mw-panel-body')!.parentElement!.parentElement!,
    'getBoundingClientRect',
  ).mockReturnValue({
    left: 0,
    top: 0,
    right: 100,
    bottom: 100,
  } as DOMRect);
  const rowIds = ['r1', 'device', 'r2'];
  for (const [index, id] of rowIds.entries()) {
    const row = panel.querySelector(`[data-source-field-id="${id}"]`)!;
    vi.spyOn(row, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 10 + index * 35,
      right: 95,
      bottom: 35 + index * 35,
    } as DOMRect);
  }
  fireEvent.click(fields.getByText('Device'));
  expect(fields.getByText('0 selected')).toBeTruthy();
  fireEvent.pointerDown(panel, { pointerType: 'mouse', button: 0, clientX: 1, clientY: 1 });
  fireEvent.pointerMove(document, { clientX: 95, clientY: 50 });
  fireEvent.pointerUp(document);
  expect(fields.getByText('2 selected')).toBeTruthy();
  const last = fields.getAllByText('Recovery')[1]!;
  fireEvent.pointerDown(last, {
    pointerType: 'mouse',
    button: 0,
    ctrlKey: true,
    clientX: 20,
    clientY: 84,
  });
  fireEvent.pointerMove(document, { clientX: 95, clientY: 350 });
  fireEvent.pointerUp(document);
  fireEvent.click(last, { ctrlKey: true });
  expect(fields.getByText('3 selected')).toBeTruthy();
  fireEvent.keyDown(last, { key: 'Escape' });
  expect(fields.getByText('0 selected')).toBeTruthy();
  fireEvent.keyDown(last, { key: 'a', ctrlKey: true });
  expect(fields.getByText('3 selected')).toBeTruthy();
});

it('shares the review footer and organizes exactly selected entries from general coverage', () => {
  const other: ReviewAsset = {
    ...origin,
    id: 'other-account',
    sourceId: 'other',
    sourceNodeId: 'other-entry',
    name: 'Other account',
    unmappedSourceFieldIds: ['foreign'],
    schemaFields: [{ key: 'secret.password', label: 'Password' }],
  };
  const alternate: ReviewAsset = { ...other, id: 'beta-target', name: 'Other destination' };
  const fieldOperations = controls();
  fieldOperations.canUndo = true;
  fieldOperations.preview.mockImplementation((request) => {
    const result = makePreview(request);
    const entries = request.entries?.map((entry) => {
      const asset = entry.sourceAssetId === origin.id ? origin : other;
      return { ...entry, nodeId: asset.sourceNodeId!, sourceId: asset.sourceId!, name: asset.name };
    });
    return {
      ...result,
      groups:
        request.groups ??
        entries?.map((entry) => ({
          id: entry.targetAssetId ?? `${entry.nodeId}:group`,
          nodeId: entry.nodeId,
          type: 'PLAIN-TEXT',
          name: `${entry.name} group`,
          fieldBindings: entries.length > 1 ? {} : { 'secret.text': entry.fieldIds },
        })) ??
        result.groups,
      affectedEntryCount: entries?.length ?? 1,
      entries,
    };
  });
  const onExcludeFields = vi.fn(() => ({ changedIds: [], skippedIds: [] }));
  const onSelect = vi.fn();
  render(
    <AssetReviewQueue
      assets={[origin, other, alternate]}
      sourceFiles={[
        { id: 'file', name: 'Alpha' },
        { id: 'other', name: 'Beta' },
      ]}
      onSelect={onSelect}
      preservation={{
        coverage: {
          ...coverage,
          fields: coverage.fields.map((field) =>
            field.sourceId === 'other' ? { ...field, nodeId: 'other-entry' } : field,
          ),
        },
        noteSources: [],
        fieldOperations,
        onExcludeFields,
      }}
    />,
  );
  const labels = ['Create assets', 'Assign to asset', 'Exclude fields'];
  const issues = openFields();
  expect(issues.getAllByRole('button', { name: /^(Create|Suggest|Split)/ })).toEqual([
    issues.getByRole('button', { name: 'Create assets' }),
  ]);
  for (const name of labels) {
    expect(issues.getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true');
  }
  fireEvent.click(issues.getByRole('button', { name: /^Close / }));
  fireEvent.click(screen.getByRole('button', { name: 'View source field details' }));
  const details = () => within(screen.getByRole('dialog', { name: 'Source field details' }));
  expect(
    details().getByRole('button', { name: 'Show Unassigned fields' }).getAttribute('aria-pressed'),
  ).toBe('true');
  fireEvent.click(details().getByRole('button', { name: 'Show All fields' }));
  expect(details().queryByText(/These fields are still available in this import/)).toBeNull();
  expect(details().getAllByTitle('Primary account · Alpha').length).toBeGreaterThan(0);
  expect(details().getByTitle('Proposed in Primary account · Username')).toBeTruthy();
  expect(details().getByText('0 selected')).toBeTruthy();
  for (const name of labels) {
    expect(details().getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true');
  }
  expect(details().getAllByRole('button', { name: /^(Create|Suggest|Split)/ })).toEqual([
    details().getByRole('button', { name: 'Create assets' }),
  ]);
  const sourceFilter = () =>
    within(details().getByRole('group', { name: 'Filter source field details by source' }));
  fireEvent.click(details().getByRole('button', { name: 'Show Proposed fields' }));
  expect(details().getByRole('checkbox', { name: 'Username from Alpha' })).toBeTruthy();
  expect(details().getByRole('button', { name: 'Show Unassigned fields' }).textContent).toBe(
    'Unassigned4',
  );
  fireEvent.click(details().getByRole('button', { name: 'Show Unassigned fields' }));
  expect(details().queryByRole('checkbox', { name: 'Username from Alpha' })).toBeNull();
  expect(details().getByRole('checkbox', { name: 'Device from Alpha' })).toBeTruthy();

  fireEvent.click(sourceFilter().getByRole('button', { name: 'Beta' }));
  expect(details().getByRole('button', { name: 'Show Unassigned fields' }).textContent).toBe(
    'Unassigned1',
  );
  fireEvent.click(details().getByRole('checkbox', { name: 'Select field in this filter' }));
  expect(details().getByText('1 selected')).toBeTruthy();
  fireEvent.click(sourceFilter().getByRole('button', { name: 'Alpha' }));
  expect(details().getByText('0 selected')).toBeTruthy();
  expect(details().getByRole('button', { name: 'Show Unassigned fields' }).textContent).toBe(
    'Unassigned3',
  );
  fireEvent.keyDown(details().getByRole('region', { name: 'Source field details' }), {
    key: 'a',
    ctrlKey: true,
  });
  fireEvent.click(details().getByRole('button', { name: 'Create assets' }));
  expect(fieldOperations.preview).toHaveBeenLastCalledWith(
    expect.objectContaining({
      fieldIds: ['r1', 'device', 'r2'],
      entries: [{ sourceAssetId: origin.id, fieldIds: ['r1', 'device', 'r2'] }],
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'View source field details' }));
  fireEvent.click(sourceFilter().getByRole('button', { name: 'All sources' }));
  fireEvent.click(details().getByRole('button', { name: 'Show All fields' }));
  const selectDevice = () =>
    fireEvent.click(details().getByRole('checkbox', { name: 'Device from Alpha' }));
  selectDevice();
  for (const name of labels) {
    expect(details().getByRole('button', { name }).getAttribute('aria-disabled')).not.toBe('true');
  }
  fireEvent.click(details().getByRole('button', { name: 'Create assets' }));
  expect(fieldOperations.preview).toHaveBeenLastCalledWith({
    action: 'create',
    sourceAssetId: origin.id,
    fieldIds: ['device'],
    entries: [{ sourceAssetId: origin.id, fieldIds: ['device'] }],
  });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  const single = within(screen.getByRole('dialog', { name: 'Create assets' }));
  expect(single.getByRole('heading', { name: 'Primary account · Alpha' })).toBeTruthy();
  expect(single.queryByRole('checkbox', { name: /compatible entries/i })).toBeNull();
  fireEvent.click(single.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'View source field details' }));
  expect(details().getByText('0 selected')).toBeTruthy();

  fireEvent.click(sourceFilter().getByRole('button', { name: 'Beta' }));
  expect(details().getByText('0 selected')).toBeTruthy();
  fireEvent.click(sourceFilter().getByRole('button', { name: 'All sources' }));
  selectDevice();
  fireEvent.click(details().getByRole('checkbox', { name: 'Recovery from Beta' }));
  fireEvent.click(details().getByRole('button', { name: 'Create assets' }));
  const several = within(screen.getByRole('dialog', { name: 'Create assets' }));
  const tabs = within(several.getByRole('group', { name: 'Field operation sources' }));
  expect(tabs.getByRole('button', { name: /All/ }).getAttribute('aria-pressed')).toBe('true');
  expect(several.getByRole('button', { name: 'Edit Other account · Beta' })).toBeTruthy();
  fireEvent.click(tabs.getByRole('button', { name: /Alpha/ }));
  expect(several.queryByRole('group', { name: 'Other account group' })).toBeNull();
  fireEvent.click(tabs.getByRole('button', { name: /Beta/ }));
  expect(several.getByRole('button', { name: 'Edit Other account', exact: true })).toBeTruthy();
  expect(several.queryByRole('button', { name: 'Edit Other account · Beta' })).toBeNull();
  fireEvent.click(several.getByRole('button', { name: 'Edit Other account', exact: true }));
  fireEvent.click(several.getByRole('button', { name: 'Group entries as Plain Text' }));
  expect(fieldOperations.preview).toHaveBeenLastCalledWith(
    expect.objectContaining({
      action: 'create',
      groups: [
        expect.objectContaining({ nodeId: 'entry', fieldBindings: {} }),
        expect.objectContaining({
          nodeId: 'other-entry',
          fieldBindings: { 'secret.text': ['foreign'] },
        }),
      ],
    }),
  );
  fireEvent.click(
    several.getByRole('button', { name: 'Add asset group for Other account · Beta' }),
  );
  expect(fieldOperations.preview).toHaveBeenLastCalledWith(
    expect.objectContaining({
      groups: expect.arrayContaining([
        expect.objectContaining({
          id: 'other-entry:ASSET-operation-extra-1',
          nodeId: 'other-entry',
        }),
      ]),
    }),
  );
  fireEvent.click(several.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'View source field details' }));
  expect(details().getByText('0 selected')).toBeTruthy();
  selectDevice();
  fireEvent.click(details().getByRole('checkbox', { name: 'Recovery from Beta' }));
  fireEvent.click(details().getByRole('button', { name: 'Assign to asset' }));
  expect(fieldOperations.preview).toHaveBeenLastCalledWith({
    action: 'move',
    sourceAssetId: origin.id,
    fieldIds: ['device', 'foreign'],
    entries: [
      { sourceAssetId: origin.id, fieldIds: ['device'], targetAssetId: origin.id },
      { sourceAssetId: other.id, fieldIds: ['foreign'], targetAssetId: other.id },
    ],
  });
  const assign = within(screen.getByRole('dialog', { name: 'Assign fields to an asset' }));
  const target = within(
    assign.getByRole('combobox', { name: 'Target asset for Other account · Beta' }),
  );
  expect(target.queryByRole('option', { name: /Primary account/ })).toBeNull();
  expect(target.getByRole('option', { name: /Other account/ })).toBeTruthy();
  fireEvent.change(
    assign.getByRole('combobox', { name: 'Target asset for Other account · Beta' }),
    {
      target: { value: alternate.id },
    },
  );
  expect(fieldOperations.preview).toHaveBeenLastCalledWith(
    expect.objectContaining({
      entries: [
        { sourceAssetId: origin.id, fieldIds: ['device'], targetAssetId: origin.id },
        { sourceAssetId: other.id, fieldIds: ['foreign'], targetAssetId: alternate.id },
      ],
    }),
  );
  fireEvent.click(assign.getByRole('button', { name: 'Confirm' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'View source field details' }));
  expect(details().getByText('0 selected')).toBeTruthy();
  expect(details().queryByText(updated.message)).toBeNull();
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(details().getByRole('button', { name: 'Undo field changes' }));
  expect(fieldOperations.undo).toHaveBeenCalledOnce();
  expect(details().getByText(restored.message)).toBeTruthy();
});

it('disables organization before opening a preview for an unavailable source asset', () => {
  const fieldOperations = controls();
  render(
    <AssetReviewQueue
      assets={[origin]}
      sourceFiles={[
        { id: 'file', name: 'Alpha' },
        { id: 'other', name: 'Beta' },
      ]}
      preservation={{
        coverage: {
          ...coverage,
          fields: coverage.fields.map((field) =>
            field.id === 'foreign' ? { ...field, nodeName: 'Other entry' } : field,
          ),
        },
        noteSources: [],
        fieldOperations,
      }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'View source field details' }));
  const details = within(screen.getByRole('dialog', { name: 'Source field details' }));
  expect(details.getByText('Other entry · Beta')).toBeTruthy();
  fireEvent.click(details.getByRole('checkbox', { name: 'Device from Alpha' }));
  fireEvent.click(details.getByRole('checkbox', { name: 'Recovery from Beta' }));
  expect(
    (details.getByRole('button', { name: 'Create assets' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(details.queryByRole('alert')).toBeNull();
  expect(details.getByText('2 selected')).toBeTruthy();
  expect(fieldOperations.preview).not.toHaveBeenCalled();
});

it('renders the first 20 compact entries and confirms the complete 1,000-entry preview', () => {
  const fields = Array.from({ length: 1000 }, (_, index) => ({
    id: `field-${index}`,
    nodeId: `entry-${index}`,
    sourceId: 'file',
    name: `Field ${index}`,
    status: 'pending' as const,
    destinations: [],
  }));
  const entries = fields.map(({ id, nodeId, sourceId }, index) => ({
    nodeId,
    sourceId,
    name: `Entry ${index}`,
    fieldIds: [id],
    sourceAssetId: `asset-${index}`,
  }));
  const request = {
    action: 'create' as const,
    sourceAssetId: entries[0].sourceAssetId,
    fieldIds: fields.map(({ id }) => id),
    entries,
  };
  const initialPreview: FieldOperationPreview = {
    ...makePreview(request),
    entries,
    groups: entries.map(({ nodeId, name, fieldIds }) => ({
      id: `group-${nodeId}`,
      nodeId,
      name,
      type: 'PLAIN-TEXT',
      fieldBindings: { 'secret.text': fieldIds },
    })),
    affectedEntryCount: entries.length,
  };
  const operations = controls();
  const onResult = vi.fn();
  render(
    <FieldOperationModal
      initialPreview={initialPreview}
      fields={fields}
      targets={[]}
      operations={operations}
      onResult={onResult}
      onDismiss={vi.fn()}
    />,
  );
  const dialog = within(screen.getByRole('dialog', { name: 'Create assets' }));
  expect(
    dialog.getByText('1000/1000 fields assigned · 1000 entries · 1000 assets to create'),
  ).toBeTruthy();
  expect(dialog.queryAllByRole('textbox', { name: 'Asset name' })).toHaveLength(0);
  expect(dialog.getAllByRole('button', { name: /^Edit Entry/ })).toHaveLength(20);
  expect(dialog.queryByRole('button', { name: 'Edit Entry 20 · Source' })).toBeNull();
  fireEvent.click(dialog.getByRole('button', { name: 'Show more entries and groups' }));
  expect(dialog.getAllByRole('button', { name: /^Edit Entry/ })).toHaveLength(40);
  expect(dialog.getByRole('button', { name: 'Edit Entry 20 · Source' })).toBeTruthy();
  fireEvent.click(dialog.getByRole('button', { name: 'Create 1000 assets' }));
  expect(operations.commit).toHaveBeenCalledWith(initialPreview);
  expect(onResult).toHaveBeenCalledWith(updated);
});

it('renames inline with an explicit save and preserves the existing name on Escape', () => {
  const rename = vi.fn(() => true);
  function Queue() {
    const [asset, setAsset] = useState(origin);
    return (
      <AssetReviewQueue
        assets={[asset]}
        preservation={{
          coverage,
          noteSources: [],
          onRenameAsset: (item, name) => {
            rename(item, name);
            setAsset({ ...item, name });
            return true;
          },
        }}
      />
    );
  }
  render(<Queue />);
  const edit = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit asset name' }));
    return screen.getByRole('textbox', { name: 'Asset name' });
  };
  const first = edit();
  expect(document.activeElement).toBe(first);
  fireEvent.change(first, { target: { value: '  ' } });
  fireEvent.keyDown(first, { key: 'Enter' });
  expect(screen.getByRole('alert').textContent).toBe('Enter an asset name.');
  fireEvent.change(first, { target: { value: 'Discard this' } });
  fireEvent.keyDown(first, { key: 'Escape' });
  expect(rename).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Inspect Primary account' })).toBeTruthy();
  const second = edit();
  fireEvent.change(second, { target: { value: '  Service account  ' } });
  fireEvent.keyDown(second, { key: 'Enter' });
  expect(rename).toHaveBeenCalledWith(origin, 'Service account');
  expect(screen.getByRole('button', { name: 'Inspect Service account' })).toBeTruthy();

  const third = edit();
  fireEvent.change(third, { target: { value: '  Production account  ' } });
  fireEvent.blur(third, {
    relatedTarget: screen.getByRole('button', { name: 'View asset issues' }),
  });
  expect(rename).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Inspect Production account' })).toBeTruthy();

  const fourth = edit();
  fireEvent.change(fourth, { target: { value: '   ' } });
  fireEvent.blur(fourth);
  expect(screen.queryByRole('textbox', { name: 'Asset name' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Inspect Production account' })).toBeTruthy();

  const fifth = edit();
  fireEvent.change(fifth, { target: { value: 'Cancel this' } });
  const cancel = screen.getByRole('button', { name: 'Cancel asset name edit' });
  fireEvent.blur(fifth, { relatedTarget: cancel });
  fireEvent.click(cancel);
  expect(rename).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Inspect Production account' })).toBeTruthy();
});

it('keeps one dialog and closes the entire operation flow on cancel', () => {
  render(
    <AssetReviewQueue
      assets={[origin]}
      preservation={{
        coverage: {
          ...coverage,
          diagnostics: [
            {
              sourceId: 'file',
              entryId: 'entry',
              code: 'settings',
              kind: 'skipped',
              message: 'Source presentation settings were skipped.',
              count: 2,
            },
          ],
        },
        noteSources: [],
        fieldOperations: controls(),
      }}
    />,
  );
  expect(screen.getAllByRole('button', { name: 'View asset issues' })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Source fields' })).toBeNull();
  const fields = openFields();
  fireEvent.click(fields.getByRole('checkbox', { name: 'Select Device' }));
  expect(fields.queryByText('Source presentation settings were skipped.')).toBeNull();
  fireEvent.click(fields.getByRole('button', { name: /Warnings/ }));
  expect(fields.getByText('Skipped · 2')).toBeTruthy();
  expect(fields.queryByRole('button', { name: 'Create assets' })).toBeNull();
  fireEvent.click(fields.getByRole('button', { name: 'Fields to resolve' }));
  expect(fields.getByText('1 selected')).toBeTruthy();
  fireEvent.click(fields.getByRole('button', { name: 'Create assets' }));
  const preview = screen.getByRole('dialog', { name: 'Create assets' });
  expect(screen.getAllByRole('dialog')).toEqual([preview]);
  fireEvent.click(within(preview).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  const reopened = openFields();
  expect(reopened.getByText('0 selected')).toBeTruthy();
});

it('edits preview groups, shows validation and repeat counts, and cancels without committing', () => {
  const fieldOperations = controls();
  render(
    <AssetReviewQueue
      assets={[origin]}
      preservation={{ coverage, noteSources: [], fieldOperations }}
    />,
  );
  const fields = openFields();
  fireEvent.click(fields.getByRole('checkbox', { name: 'Select all 3 fields' }));
  fireEvent.click(fields.getByRole('button', { name: 'Create assets' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Create assets' }));
  expect(dialog.getByText('3/3 fields assigned')).toBeTruthy();

  fireEvent.click(dialog.getByRole('button', { name: 'Add asset group' }));
  const groups = dialog.getAllByRole('group');
  expect(groups).toHaveLength(2);
  expect(fieldOperations.preview.mock.lastCall?.[0].groups?.[1]?.automaticName).toBe(true);
  expect(dialog.getByRole('alert').textContent).toMatch(/Complete each destination/);
  expect(dialog.getByRole('button', { name: 'Confirm' }).hasAttribute('disabled')).toBe(true);
  const firstGroup = within(groups[0]!);
  const secondGroup = within(groups[1]!);
  fireEvent.click(secondGroup.getByRole('button', { name: 'Choose fields' }));
  expect(secondGroup.getByText('No fields available for this group.')).toBeTruthy();

  fireEvent.keyDown(firstGroup.getByRole('button', { name: 'Remove Device from protected text' }), {
    key: 'Enter',
  });
  expect(document.activeElement).toBe(firstGroup.getByRole('button', { name: 'Choose fields' }));
  expect(dialog.getByText('2/3 fields assigned')).toBeTruthy();
  expect(dialog.getByText('1 field stays in the original entry.')).toBeTruthy();
  expect(
    secondGroup.queryByRole('button', { name: 'Include Recovery in protected text' }),
  ).toBeNull();
  const search = secondGroup.getByRole('textbox', { name: 'Search fields' });
  fireEvent.change(search, { target: { value: 'missing' } });
  expect(secondGroup.getByText('No fields match your search.')).toBeTruthy();
  fireEvent.change(search, { target: { value: 'devi' } });
  const deviceChoice = secondGroup.getByRole('button', {
    name: 'Include Device in protected text',
  });
  fireEvent.click(deviceChoice);
  expect(deviceChoice.getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(secondGroup.queryByRole('textbox', { name: 'Search fields' })).toBeNull();
  expect(document.activeElement).toBe(secondGroup.getByRole('button', { name: 'Choose fields' }));
  expect(
    secondGroup.getByRole('button', { name: 'Remove Device from protected text' }),
  ).toBeTruthy();
  expect(dialog.getByText('3/3 fields assigned')).toBeTruthy();
  fireEvent.change(within(groups[1]).getByRole('textbox', { name: 'Asset name' }), {
    target: { value: 'Device group' },
  });
  const last = fieldOperations.preview.mock.lastCall?.[0];
  expect(last?.operationId).toBe('operation');
  expect(last?.action).toBe('create');
  expect(last?.groups?.map(({ id, type, fieldBindings }) => [id, type, fieldBindings])).toEqual([
    ['entry:ASSET-operation-0', 'PLAIN-TEXT', { 'secret.text': ['r1', 'r2'] }],
    ['entry:ASSET-operation-extra-1', 'PLAIN-TEXT', { 'secret.text': ['device'] }],
  ]);
  const repeat = dialog.getByRole('checkbox', { name: 'Apply to compatible entries' });
  expect(dialog.getByRole('heading', { name: 'Where this applies' })).toBeTruthy();
  expect(dialog.getByRole('status').textContent).toContain('Selected entry only');
  expect(document.getElementById(repeat.getAttribute('aria-describedby')!)?.textContent).toContain(
    'Each entry keeps its own values.',
  );
  fireEvent.click(repeat);
  expect(dialog.getByText('3 entries affected · 2 skipped')).toBeTruthy();
  expect(dialog.getByRole('checkbox', { name: 'Apply to 3 compatible entries' })).toBeTruthy();
  fireEvent.click(secondGroup.getByRole('button', { name: 'Remove asset group' }));
  expect(dialog.getAllByRole('group')).toHaveLength(1);
  expect(dialog.getByText('2/3 fields assigned')).toBeTruthy();
  fireEvent.click(dialog.getByRole('button', { name: 'Group as Plain Text' }));
  expect(dialog.getByText('3/3 fields assigned')).toBeTruthy();
  fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
  expect(fieldOperations.commit).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('bounds large field lists, expands selected chips, and confirms the edited selection', () => {
  const fieldOperations = controls();
  const extraFields = Array.from({ length: 30 }, (_, index) => ({
    id: `extra-${index}`,
    name: `Field ${index}`,
    status: 'pending' as const,
    sourceId: 'file',
    nodeId: 'entry',
    destinations: [],
  }));
  render(
    <AssetReviewQueue
      assets={[
        {
          ...origin,
          unmappedSourceFieldIds: extraFields.map(({ id }) => id),
          unmapped: extraFields.map(({ name }) => name),
        },
      ]}
      preservation={{
        coverage: { ...coverage, fields: extraFields },
        noteSources: [],
        fieldOperations,
      }}
    />,
  );
  const issues = openFields();
  fireEvent.click(issues.getByRole('checkbox', { name: 'Select all 30 fields' }));
  fireEvent.click(issues.getByRole('button', { name: 'Create assets' }));
  const editor = within(screen.getByRole('dialog', { name: 'Create assets' }));
  expect(editor.getByText('30/30 fields assigned')).toBeTruthy();
  expect(editor.getAllByRole('button', { name: /^Remove Field/ })).toHaveLength(3);
  fireEvent.click(editor.getByRole('button', { name: 'Show 27 more selected fields' }));
  expect(editor.getAllByRole('button', { name: /^Remove Field/ })).toHaveLength(25);
  fireEvent.click(editor.getByRole('button', { name: 'Next selected fields' }));
  expect(editor.getAllByRole('button', { name: /^Remove Field/ })).toHaveLength(5);
  fireEvent.click(editor.getByRole('button', { name: 'Show fewer selected fields' }));
  expect(editor.getAllByRole('button', { name: /^Remove Field/ })).toHaveLength(3);

  fireEvent.click(editor.getByRole('button', { name: 'Choose fields' }));
  expect(editor.getAllByRole('button', { name: /^Include Field/ })).toHaveLength(25);
  fireEvent.click(editor.getByRole('button', { name: 'Next fields' }));
  expect(editor.getAllByRole('button', { name: /^Include Field/ })).toHaveLength(5);
  const search = editor.getByRole('textbox', { name: 'Search fields' });
  fireEvent.change(search, { target: { value: 'field 2' } });
  expect(editor.getAllByRole('button', { name: /^Include Field/ })).toHaveLength(11);
  fireEvent.click(editor.getByRole('button', { name: 'Include Field 29 in protected text' }));
  expect(editor.getByText('29/30 fields assigned')).toBeTruthy();
  fireEvent.click(editor.getByRole('button', { name: 'Confirm' }));
  expect(fieldOperations.commit).toHaveBeenCalledWith(
    expect.objectContaining({
      groups: [
        expect.objectContaining({
          fieldBindings: { 'secret.text': extraFields.slice(0, -1).map(({ id }) => id) },
        }),
      ],
    }),
  );
});

it('offers whole-value copy only for edited Plain Text and restores the selected row after undo', () => {
  const fieldOperations = controls();
  const resolveSourceValue = vi.fn();
  const sensitive = new SensitiveValue('sample-literal-value');
  const onSelect = vi.fn();
  function Workspace() {
    const [committed, setCommitted] = useState(false);
    return (
      <AssetReviewQueue
        assets={[
          { ...origin, type: 'PLAIN-TEXT', plainTextValue: sensitive },
          ...(committed ? [created] : []),
        ]}
        onSelect={onSelect}
        resolveSourceValue={resolveSourceValue}
        preservation={{
          coverage,
          noteSources: [],
          fieldOperations: {
            ...fieldOperations,
            canUndo: committed,
            commit: (preview) => {
              setCommitted(true);
              return fieldOperations.commit(preview);
            },
            undo: () => {
              setCommitted(false);
              return fieldOperations.undo();
            },
          },
        }}
      />
    );
  }
  render(<Workspace />);
  const fields = openFields();
  expect(fields.queryByRole('checkbox')).toBeNull();
  expect(fields.getByText(/no longer has individual field links/)).toBeTruthy();
  fireEvent.click(fields.getByRole('button', { name: 'Create a Plain Text copy' }));
  expect(fieldOperations.preview).toHaveBeenLastCalledWith(
    expect.objectContaining({ action: 'duplicate-text', fieldIds: [] }),
  );
  expect(document.body.textContent).not.toContain('sample-literal-value');
  expect(resolveSourceValue).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(onSelect).toHaveBeenLastCalledWith(created);
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Inspect New protected asset' }),
  );
  expect(screen.queryByText('Fields organized.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Undo field changes' }));
  expect(fieldOperations.undo).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Inspect Primary account' }),
  );
  expect(screen.getByText('Fields restored.')).toBeTruthy();
});

it('only shows pending fields when typed siblings cover the other source fields', () => {
  const session = createEmptyImportSession('sibling-review');
  session.sources = [
    {
      id: 'file',
      kind: 'dotenv',
      name: 'Fixture',
      fileName: 'Fixture',
      importedAt: '',
      warnings: [],
    },
  ];
  session.rootNodeIds = ['entry'];
  const names = ['username', 'password', 'first_api_key', 'second_api_key', 'recovery_hint'];
  session.nodesById.entry = {
    id: 'entry',
    name: 'Integration',
    kind: 'entry',
    sourceId: 'file',
    parentNodeId: null,
    path: [],
    childNodeIds: [],
    fieldIds: names,
  };
  for (const name of names) {
    session.fieldsById[name] = {
      id: name,
      name,
      sourceId: 'file',
      parentNodeId: 'entry',
      sourcePath: [],
      metadata: {},
      value: new SensitiveValue(`synthetic-${name}`),
    };
  }
  function Workspace() {
    const [state, setState] = useState(createEmptyWorkspace);
    const workspace = useImporterWorkspace(session, state, setState);
    const account = workspace.assets.find(({ type }) => type === 'USER-PSWD')!;
    return (
      <AssetReviewQueue
        assets={workspace.assets}
        selectedId={account.id}
        preservation={{
          coverage: workspace.coverage,
          noteSources: workspace.noteSources,
          fieldOperations: workspace.fieldOperations,
          onExcludeFields: workspace.excludeFields,
        }}
      />
    );
  }
  render(<Workspace />);
  expect(screen.queryByRole('button', { name: /Inspect .*additional fields/i })).toBeNull();
  const fields = openFields();
  expect(fields.queryByText(/Proposed in .* · API Key/i)).toBeNull();
  expect(fields.queryByText('username')).toBeNull();
  expect(fields.queryByRole('checkbox', { name: 'Select first_api_key' })).toBeNull();
  expect(fields.queryByRole('checkbox', { name: 'Select second_api_key' })).toBeNull();
  expect(fields.getByRole('checkbox', { name: 'Select recovery_hint' })).toBeTruthy();
  expect(fields.getByText('Unassigned')).toBeTruthy();
  fireEvent.click(fields.getByRole('checkbox', { name: 'Select recovery_hint' }));
  fireEvent.click(fields.getByRole('button', { name: 'Create assets' }));
  expect(screen.getByRole('button', { name: 'Confirm' }).hasAttribute('disabled')).toBe(false);
  const single = within(screen.getByRole('dialog', { name: 'Create assets' }));
  expect((single.getByRole('textbox', { name: 'Asset name' }) as HTMLInputElement).value).toBe(
    'Integration — Additional 1',
  );
  fireEvent.click(single.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  const reopenedFields = openFields();
  fireEvent.click(reopenedFields.getByRole('checkbox', { name: 'Select recovery_hint' }));
  fireEvent.click(
    within(screen.getByRole('dialog', { name: /— Issues$/ })).getByRole('button', {
      name: 'Create assets',
    }),
  );
  const several = within(screen.getByRole('dialog', { name: 'Create assets' }));
  expect(several.getByText('1/1 field assigned')).toBeTruthy();
  expect(several.queryByRole('alert')).toBeNull();
  fireEvent.click(several.getByRole('button', { name: 'Add asset group' }));
  expect(
    several
      .getAllByRole<HTMLInputElement>('textbox', { name: 'Asset name' })
      .map(({ value }) => value),
  ).toEqual(['Integration — Additional 1', 'Integration — Additional 2']);

  fireEvent.click(several.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  const issues = openFields();
  fireEvent.click(issues.getByRole('checkbox', { name: 'Select recovery_hint' }));
  fireEvent.click(issues.getByRole('button', { name: 'Exclude fields' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm exclusion' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText('1 excluded · 0 skipped')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Inspect Integration' })).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: 'View source field details' }));
  const details = within(screen.getByRole('dialog', { name: 'Source field details' }));
  fireEvent.click(details.getByRole('button', { name: /Show excluded fields/i }));
  expect(details.getByText('recovery_hint')).toBeTruthy();
  expect(details.queryByText('username')).toBeNull();
});

it('reserves assigned source IDs within a group without treating equal labels as equal fields', () => {
  const fieldOperations = controls();
  fieldOperations.schemaFields = () => [
    { key: 'secret.username', label: 'Username', required: true },
    { key: 'secret.password', label: 'Password', required: true },
  ];
  render(
    <AssetReviewQueue
      assets={[origin]}
      preservation={{ coverage, noteSources: [], fieldOperations }}
    />,
  );
  const issues = openFields();
  for (const checkbox of issues.getAllByRole('checkbox', { name: 'Select Recovery' })) {
    fireEvent.click(checkbox);
  }
  fireEvent.click(issues.getByRole('button', { name: 'Create assets' }));
  const editor = within(screen.getByRole('dialog', { name: 'Create assets' }));
  fireEvent.change(editor.getByRole('combobox', { name: 'Asset type' }), {
    target: { value: 'API-KEY' },
  });
  fireEvent.click(editor.getByRole('button', { name: 'Choose Username source field' }));
  const userChoices = editor.getAllByRole('button', { name: 'Map Username to Recovery' });
  expect(userChoices).toHaveLength(2);
  fireEvent.click(userChoices[0]!);
  fireEvent.click(editor.getByRole('button', { name: 'Choose Password source field' }));
  const passwordChoice = editor.getByRole('button', { name: 'Map Password to Recovery' });
  fireEvent.click(passwordChoice);
  expect(fieldOperations.preview.mock.lastCall?.[0].groups?.[0]?.fieldBindings).toEqual({
    'secret.username': 'r1',
    'secret.password': 'r2',
  });
  fireEvent.click(editor.getByRole('button', { name: 'Exclude Username field from this Asset' }));
  fireEvent.click(editor.getByRole('button', { name: 'Change Password source field' }));
  expect(editor.getAllByRole('button', { name: 'Map Password to Recovery' })).toHaveLength(2);
});

it('keeps structured group identity stable through type, name, and source edits', () => {
  const fieldOperations = controls();
  render(
    <AssetReviewQueue
      assets={[origin]}
      preservation={{ coverage, noteSources: [], fieldOperations }}
    />,
  );
  const fields = openFields();
  fireEvent.click(fields.getByRole('checkbox', { name: 'Select Device' }));
  fireEvent.click(fields.getByRole('button', { name: 'Create assets' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Create assets' }));
  fireEvent.change(dialog.getByRole('combobox', { name: 'Asset type' }), {
    target: { value: 'API-KEY' },
  });
  expect(dialog.getByText('API key *')).toBeTruthy();
  expect(dialog.getByRole('button', { name: 'Confirm' }).hasAttribute('disabled')).toBe(true);
  fireEvent.change(dialog.getByRole('textbox', { name: 'Asset name' }), {
    target: { value: 'Manual key' },
  });
  fireEvent.click(dialog.getByRole('button', { name: 'Choose API key source field' }));
  fireEvent.click(dialog.getByRole('button', { name: 'Map API key to Device' }));
  expect(fieldOperations.preview.mock.lastCall?.[0].groups).toEqual([
    {
      id: 'entry:ASSET-operation-0',
      nodeId: 'entry',
      type: 'API-KEY',
      name: 'Manual key',
      automaticName: false,
      fieldBindings: { 'secret.apiKey': 'device' },
    },
  ]);
  expect(dialog.getByRole('button', { name: 'Confirm' }).hasAttribute('disabled')).toBe(false);
});

it('labels the current asset and limits assignment to eligible assets without overriding existing mappings', () => {
  const target = { ...origin, id: 't1', name: 'Same-entry account' };
  const another = { ...origin, id: 't2', name: 'Another in this entry' };
  const fieldOperations = controls();
  fieldOperations.preview.mockImplementation((request) => {
    const preview = makePreview(request);
    const destination = request.targetAssetId === target.id ? target : another;
    return {
      ...preview,
      assets: [destination],
      groups: request.groups ?? [
        {
          id: destination.id,
          nodeId: destination.sourceNodeId!,
          type: destination.type,
          name: destination.name,
          fieldBindings: {},
        },
      ],
    };
  });
  render(
    <AssetReviewQueue
      assets={[
        origin,
        target,
        another,
        { ...target, id: 'foreign', name: 'Other entry', sourceNodeId: 'outside' },
        {
          ...target,
          id: 'full',
          name: 'Full asset',
          schemaFields: [{ key: 'secret.username', label: 'Username', sourceFieldId: 'user' }],
        },
      ]}
      preservation={{ coverage, noteSources: [], fieldOperations }}
    />,
  );
  const fields = openFields();
  fireEvent.click(fields.getByRole('checkbox', { name: 'Select Device' }));
  fireEvent.click(fields.getByRole('button', { name: 'Assign to asset' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Assign fields to an asset' }));
  expect(dialog.getAllByRole('option')).toHaveLength(3);
  expect(dialog.getByRole('option', { name: /^This asset — Primary account/ })).toBeTruthy();
  expect(dialog.getByText('Already mapped in the target asset')).toBeTruthy();
  expect(dialog.queryByRole('button', { name: 'Choose Username source field' })).toBeNull();
  fireEvent.change(dialog.getByRole('combobox', { name: 'Target asset' }), {
    target: { value: 't2' },
  });
  expect(fieldOperations.preview.mock.lastCall?.[0]).toEqual(
    expect.objectContaining({
      sourceAssetId: 'origin',
      fieldIds: ['device'],
      action: 'move',
      targetAssetId: 't2',
    }),
  );
  expect(dialog.queryByRole('checkbox', { name: /^Apply to/ })).toBeNull();
});

it('omits the Plain Text origin from existing assignment destinations', () => {
  const source = {
    ...created,
    name: 'Protected source',
    schemaFields: [],
    plainTextSources: [{ id: 'device', name: 'Device' }],
  };
  render(
    <AssetReviewQueue
      assets={[source, origin]}
      preservation={{ coverage, noteSources: [], fieldOperations: controls() }}
    />,
  );
  const issues = openFields();
  fireEvent.click(issues.getByRole('checkbox', { name: 'Select Device' }));
  fireEvent.click(issues.getByRole('button', { name: 'Assign to asset' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Assign fields to an asset' }));
  expect(dialog.getAllByRole('option').map((option) => option.textContent)).toEqual([
    'Primary account · Username and Password',
  ]);
});

it('blocks mixed proposed selections before preview and preserves exclusion', () => {
  const fieldOperations = controls();
  const onExcludeFields = vi.fn(() => ({ changedIds: ['user'], skippedIds: [] }));
  render(
    <AssetReviewQueue
      assets={[origin]}
      sourceFiles={[{ id: 'file', name: 'Alpha' }]}
      preservation={{ coverage, noteSources: [], fieldOperations, onExcludeFields }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'View source field details' }));
  const details = within(screen.getByRole('dialog', { name: 'Source field details' }));
  fireEvent.click(details.getByRole('button', { name: 'Show All fields' }));
  fireEvent.click(details.getByRole('checkbox', { name: 'Username from Alpha' }));
  fireEvent.click(details.getByRole('checkbox', { name: 'Device from Alpha' }));
  for (const name of ['Create assets', 'Assign to asset']) {
    expect((details.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
  }
  expect(
    (details.getByRole('button', { name: 'Exclude fields' }) as HTMLButtonElement).disabled,
  ).toBe(false);
  expect(fieldOperations.preview).not.toHaveBeenCalled();
  fireEvent.click(details.getByRole('checkbox', { name: 'Username from Alpha' }));
  expect(
    (details.getByRole('button', { name: 'Create assets' }) as HTMLButtonElement).disabled,
  ).toBe(false);
  fireEvent.click(details.getByRole('button', { name: 'Create assets' }));
  expect(fieldOperations.preview).toHaveBeenLastCalledWith(
    expect.objectContaining({ fieldIds: ['device'] }),
  );
});

it('opens warning-only assets on Warnings and labels their already included fields clearly', () => {
  const asset: ReviewAsset = {
    ...origin,
    type: 'PLAIN-TEXT',
    status: 'suggested',
    unmapped: [],
    unmappedSourceFieldIds: [],
    schemaFields: [{ key: 'secret.text', label: 'Plain text secret', required: true }],
    plainTextSources: [
      { id: 'pin', name: 'Access: PIN' },
      { id: 'tag', name: 'Access: Asset tag' },
    ],
  };
  const included: SourceCoverage = {
    ready: true,
    diagnostics: [
      {
        sourceId: 'file',
        entryId: 'entry',
        code: 'settings',
        kind: 'skipped',
        message: 'Source settings were omitted.',
        count: 3,
      },
    ],
    fields: ['pin', 'tag'].map((id) => ({
      id,
      name: id === 'pin' ? 'Access: PIN' : 'Access: Asset tag',
      sourceId: 'file',
      nodeId: 'entry',
      status: 'protected',
      destinations: [{ assetId: asset.id, fieldId: 'secret.text', valid: true }],
    })),
  };
  render(
    <AssetReviewQueue
      assets={[asset]}
      preservation={{ coverage: included, noteSources: [], fieldOperations: controls() }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'View asset issues' }));
  const warnings = within(screen.getByRole('dialog', { name: 'Primary account — Warnings' }));
  expect(warnings.getByText('Source settings were omitted.')).toBeTruthy();
  expect(warnings.queryByRole('checkbox', { name: 'Select Access: PIN' })).toBeNull();
  fireEvent.click(warnings.getByRole('button', { name: 'Included fields' }));
  const fields = within(screen.getByRole('dialog', { name: 'Primary account — Included fields' }));
  expect(fields.getByText(/These fields are already included in this asset/)).toBeTruthy();
  expect(fields.getByRole('checkbox', { name: 'Select Access: PIN' })).toBeTruthy();
  expect(fields.queryByText('Unassigned')).toBeNull();
});
