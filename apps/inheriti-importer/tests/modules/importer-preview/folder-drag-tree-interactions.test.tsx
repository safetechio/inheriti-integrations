import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OrganizationFolderTree } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree';

const folder = (id: string, name: string, parentId: string | null = null) => ({ id, name, parentId, scope: 'SHARED' as const, revision: 1 });
const source = folder('source', 'Source');
const child = folder('child', 'Child', 'source');
const target = folder('target', 'Target');
function setup() {
  const data = new Map<string, string>();
  const transfer = { getData: (key: string) => data.get(key) ?? '', setData: (key: string, value: string) => data.set(key, value), setDragImage: vi.fn(), types: ['text/folder-ids'], dropEffect: 'none', effectAllowed: 'move' };
  const move = vi.fn();
  render(<OrganizationFolderTree plans={[]} dragAssets={[]} workspace={{ folders: [source, child, target], scope: 'SHARED', onMoveFolder: move, onPreviewFolderChange: vi.fn() }} />);
  return { transfer, move, row: (name: string) => screen.getAllByText(name).map((node) => node.closest('[role="treeitem"]')).find(Boolean)! };
}
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('marks self and descendants invalid and refuses their drops', () => {
  const { transfer, move, row } = setup();
  fireEvent.click(screen.getByText('Source'));
  fireEvent.dragStart(row('Source'), { dataTransfer: transfer });
  fireEvent.dragOver(row('Source'), { dataTransfer: transfer });
  expect(row('Source').className).toContain('over-invalid');
  fireEvent.dragOver(row('Child'), { dataTransfer: transfer });
  expect(row('Child').className).toContain('over-invalid');
  expect(transfer.dropEffect).toBe('none');
  fireEvent.drop(row('Child'), { dataTransfer: transfer });
  expect(move).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('expands a valid destination after sustained hover despite repeated dragover events', () => {
  vi.useFakeTimers();
  const { transfer, row } = setup();
  fireEvent.dragStart(row('Source'), { dataTransfer: transfer });
  fireEvent.dragOver(row('Target'), { dataTransfer: transfer });
  expect(row('Target').className).toContain('over-valid');
  for (let step = 0; step < 3; step++) {
    act(() => vi.advanceTimersByTime(200));
    fireEvent.dragOver(row('Target'), { dataTransfer: transfer });
  }
  expect(row('Target').getAttribute('aria-expanded')).toBe('true');
  expect(transfer.dropEffect).toBe('move');
});
