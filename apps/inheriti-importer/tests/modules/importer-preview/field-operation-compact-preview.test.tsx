// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FieldOperationModal } from '@modules/importer-preview/AssetReviewQueue/components/FieldOperationModal';
import type {
  FieldOperationPreview,
  FieldOperationRequest,
} from '@modules/importer-preview/AssetReviewQueue/field-operations';

afterEach(cleanup);

function renderCompactPreview({ sameSource = false, invalidTemplate = false } = {}) {
  const fields = Array.from({ length: 3 }, (_, index) => ({
    id: `field-${index}`,
    nodeId: `node-${index}`,
    sourceId: !sameSource && index === 1 ? 'second' : 'first',
    name: 'Token',
    status: 'pending' as const,
    destinations: [],
  }));
  const entries = fields.map(({ id, nodeId, sourceId }, index) => ({
    name: `Entry ${index}`,
    sourceAssetId: `source-${index}`,
    fieldIds: [id],
    nodeId,
    sourceId,
  }));
  const groups = entries.map(({ nodeId, name, fieldIds }) => ({
    id: `${nodeId}:ASSET-test-1`,
    nodeId,
    name,
    type: 'PLAIN-TEXT',
    fieldBindings: { 'secret.text': fieldIds },
  }));
  const initialPreview: FieldOperationPreview = {
    request: {
      action: 'create',
      operationId: 'test',
      sourceAssetId: entries[0].sourceAssetId,
      fieldIds: fields.map(({ id }) => id),
      entries,
    },
    entries,
    groups,
    token: Symbol(),
    assets: groups.map(({ id, name, type, fieldBindings }, index) => ({
      id,
      name,
      type,
      status: 'suggested',
      rationale: '',
      mapped: [],
      unmapped: [],
      source: 'First',
      alternatives: [],
      schemaFields: [
        {
          key: 'secret.text',
          label: 'Text',
          sourceFieldId: fieldBindings['secret.text'][0],
          validationError: invalidTemplate && index === 0 ? 'Invalid protected text' : undefined,
        },
      ],
    })),
    errors: [],
    canConfirm: true,
    affectedEntryCount: 3,
    compatibleEntryCount: 3,
    skippedEntryCount: 0,
    movedFieldCount: 3,
    remainingFieldCount: 0,
  };
  const preview = vi.fn((request: FieldOperationRequest): FieldOperationPreview => ({
    ...initialPreview,
    request,
    groups: request.groups ?? groups,
  }));
  const commit = vi.fn(() => ({
    success: true,
    message: 'Created',
    createdAssetIds: groups.map(({ id }) => id),
    changedAssetIds: [],
  }));
  const dismiss = vi.fn();
  render(
    <FieldOperationModal
      initialPreview={initialPreview}
      fields={fields}
      targets={[]}
      sourceNames={
        new Map([
          ['first', 'First'],
          ['second', 'Second'],
        ])
      }
      operations={{ preview, commit, canUndo: false, undo: commit }}
      onResult={vi.fn()}
      onDismiss={dismiss}
    />,
  );
  const dialog = within(screen.getByRole('dialog', { name: 'Create assets' }));
  return { dialog, groups, preview, commit, dismiss };
}

it('edits one compact row at a time, preserves its edits across tabs, and confirms the full selection', () => {
  const { dialog, groups, commit, dismiss } = renderCompactPreview();
  const tabs = within(dialog.getByRole('group', { name: 'Field operation sources' }));
  const first = dialog.getByRole('button', { name: 'Edit Entry 0 · First' });
  const second = dialog.getByRole('button', { name: 'Edit Entry 1 · Second' });

  expect(dialog.queryByRole('textbox', { name: 'Asset name' })).toBeNull();
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(second);
  fireEvent.keyDown(second, { key: 'Enter' });
  const name = dialog.getByRole('textbox', { name: 'Asset name' }) as HTMLInputElement;
  fireEvent.change(name, { target: { value: 'Edited destination' } });
  name.focus();
  fireEvent.keyDown(name, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(name);

  fireEvent.click(tabs.getByRole('button', { name: /First/ }));
  expect(dialog.queryByRole('textbox', { name: 'Asset name' })).toBeNull();
  const scopedFirst = dialog.getByRole('button', { name: 'Edit Entry 0' });
  fireEvent.keyDown(scopedFirst, { key: 'a', ctrlKey: true });
  expect(dialog.getByText('2 entries selected for layout')).toBeTruthy();

  fireEvent.click(tabs.getByRole('button', { name: /Second/ }));
  expect((dialog.getByRole('textbox', { name: 'Asset name' }) as HTMLInputElement).value).toBe(
    'Edited destination',
  );
  fireEvent.click(dialog.getByRole('button', { name: 'Collapse Entry 1' }));
  expect(dialog.queryByRole('textbox', { name: 'Asset name' })).toBeNull();
  fireEvent.click(dialog.getByRole('button', { name: 'Edit Entry 1' }));
  expect((dialog.getByRole('textbox', { name: 'Asset name' }) as HTMLInputElement).value).toBe(
    'Edited destination',
  );
  expect(dialog.getByText('3/3 fields assigned · 3 entries · 3 assets to create')).toBeTruthy();
  fireEvent.click(dialog.getByRole('button', { name: 'Create 3 assets' }));
  expect(commit).toHaveBeenCalledWith(
    expect.objectContaining({
      groups: [
        groups[0],
        { ...groups[1], name: 'Edited destination', automaticName: false },
        groups[2],
      ],
    }),
  );
  expect(dismiss).not.toHaveBeenCalled();
});

it('keeps an empty layout selection restricted until all matching entries are explicitly enabled', () => {
  const { dialog, preview } = renderCompactPreview({ sameSource: true });
  fireEvent.click(dialog.getByRole('button', { name: 'Edit Entry 0 · First' }));
  const target = dialog.getByRole('checkbox', { name: 'Select Entry 1 · First for layout' });
  const apply = (count: number) =>
    dialog.getByRole('button', {
      name: `Apply layout to ${count} matching ${count === 1 ? 'entry' : 'entries'}`,
    }) as HTMLButtonElement;
  expect(apply(2).disabled).toBe(false);

  fireEvent.click(target);
  expect(apply(1).disabled).toBe(false);
  fireEvent.click(target);
  expect(apply(0).disabled).toBe(true);

  fireEvent.click(target);
  fireEvent.click(dialog.getByRole('button', { name: 'Clear layout selection' }));
  expect(apply(0).disabled).toBe(true);
  expect(preview).not.toHaveBeenCalled();

  fireEvent.click(dialog.getByRole('button', { name: 'Use all matching entries' }));
  expect(apply(2).disabled).toBe(false);
  fireEvent.click(apply(2));
  expect(preview).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'create',
      groups: expect.arrayContaining([
        expect.objectContaining({
          nodeId: 'node-1',
          fieldBindings: { 'secret.text': ['field-1'] },
        }),
        expect.objectContaining({
          nodeId: 'node-2',
          fieldBindings: { 'secret.text': ['field-2'] },
        }),
      ]),
    }),
  );
});

it('disables applying a fully assigned template with an invalid destination', () => {
  const { dialog, preview } = renderCompactPreview({ sameSource: true, invalidTemplate: true });
  fireEvent.click(dialog.getByRole('button', { name: 'Edit Entry 0 · First' }));
  const apply = dialog.getByRole('button', {
    name: 'Apply layout to 0 matching entries',
  }) as HTMLButtonElement;
  expect(apply.disabled).toBe(true);
  fireEvent.click(apply);
  expect(preview).not.toHaveBeenCalled();
});
