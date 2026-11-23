// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CompactEntryRow } from '@modules/importer-preview/AssetReviewQueue/components/FieldOperationModal/components/CompactEntryRow';
import { getPlanAssetIconName } from '@modules/plans/domain/asset-metadata';

afterEach(cleanup);

it('shows compact asset metadata and selects from the entire row with modifiers', () => {
  const onEdit = vi.fn();
  const onSelect = vi.fn();
  const { container } = render(
    <CompactEntryRow
      entryId="entry-1"
      name="Recovery note"
      type="PLAIN-TEXT"
      typeLabel="Plain Text"
      fieldSummary="1/1 fields assigned"
      status="Ready"
      expanded={false}
      selected={false}
      onEdit={onEdit}
      onSelect={onSelect}
      onNavigate={vi.fn()}
      rowRef={null}
    />,
  );

  const editControl = screen.getByRole('button', { name: 'Edit Recovery note' });
  const row = within(editControl);
  const icon = row.getByTestId('font-awesome-6');
  const typeLabel = row.getByText('Plain Text');
  expect(icon.getAttribute('aria-label')).toBe(getPlanAssetIconName('PLAIN-TEXT'));
  expect(typeLabel.parentElement).toBe(icon.parentElement);
  expect(row.getByText('1/1 fields assigned')).toBeTruthy();
  expect(row.getByText('Ready')).toBeTruthy();
  const frame = container.querySelector('[data-field-operation-entry-id="entry-1"]')!;
  fireEvent.click(frame, { ctrlKey: true });
  fireEvent.click(typeLabel, { metaKey: true });
  fireEvent.click(screen.getByRole('checkbox'), { shiftKey: true });
  expect(onSelect.mock.calls).toEqual([[false], [false], [true]]);
  expect(onEdit).not.toHaveBeenCalled();
  fireEvent.click(editControl);
  expect(onEdit).toHaveBeenCalledOnce();
});
