import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMarqueeSelection } from '../../../src/modules/_shared/ui/hooks/use-marquee-selection';
import { Box, Text } from '@main-components';

function Fixture({ startSelector, excludeSelector, containerKey, initialIds = [] }: {
  startSelector?: string;
  excludeSelector?: string;
  containerKey?: string;
  initialIds?: string[];
} = {}) {
  const [ids, setIds] = useState(initialIds);
  const [key, setKey] = useState('one');
  const marquee = useMarqueeSelection({
    selectedIds: ids,
    onSelect: setIds,
    resetKey: key,
    startSelector,
    excludeSelector,
    rowSelector: '[data-row-id]',
    getRowIds: (row) => [row.dataset.rowId!],
  });
  return <>
    <button onClick={() => setKey('two')}>Reset</button>
    <span data-testid="ids">{ids.join(',')}</span>
    <Box key={containerKey} ref={marquee.setContainerRef}>
      <Box dataSet={{ rowId: 'a' }} draggable>
        <Box role="button" dataSet={{ marqueeRowControl: '' }} onClick={() => setIds(['clicked'])}>
          <Text>A</Text>
        </Box>
        <input type="checkbox" aria-label="Select A" />
        <button>Actions</button>
      </Box>
      <Box dataSet={{ rowId: 'b' }}><Text>B</Text></Box>
      {marquee.rectangle && <output data-testid="rectangle" />}
    </Box>
  </>;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('selects intersecting mounted rows after five pixels and blocks the following click', () => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  render(<Fixture />);
  const row = screen.getByText('A').closest('[data-row-id]')!;
  vi.spyOn(row.parentElement!, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 100, bottom: 100 } as DOMRect);
  vi.spyOn(row, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 10, right: 30, bottom: 30 } as DOMRect);
  fireEvent.pointerDown(screen.getByText('A'), { pointerType: 'mouse', button: 0, ctrlKey: true, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(document, { clientX: 3, clientY: 0 });
  expect(screen.getByTestId('ids').textContent).toBe('');
  expect(fireEvent.dragStart(row)).toBe(false);
  expect(fireEvent(screen.getByText('A'), new Event('selectstart', { bubbles: true, cancelable: true }))).toBe(false);
  fireEvent.pointerMove(document, { clientX: 20, clientY: 20 });
  fireEvent.pointerUp(document);
  expect(screen.getByTestId('ids').textContent).toBe('a');
  fireEvent.click(screen.getByText('A'));
  expect(screen.getByTestId('ids').textContent).toBe('a');
});

it('ends pending gestures on Escape and reset', () => {
  render(<Fixture />);
  const row = screen.getByText('A').closest('[data-row-id]')!;
  vi.spyOn(row.parentElement!, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 100, bottom: 100 } as DOMRect);
  fireEvent.pointerDown(row, { pointerType: 'mouse', button: 0, ctrlKey: true, clientX: 0, clientY: 0 });
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.pointerMove(document, { clientX: 20, clientY: 20 });
  expect(screen.getByTestId('ids').textContent).toBe('');
  fireEvent.pointerDown(row, { pointerType: 'mouse', button: 0, ctrlKey: true, clientX: 0, clientY: 0 });
  fireEvent.click(screen.getByText('Reset'));
  fireEvent.pointerMove(document, { clientX: 20, clientY: 20 });
  expect(screen.getByTestId('ids').textContent).toBe('');
});

it('cancels a pending gesture and binds selection to a replacement container', () => {
  const requestFrame = vi.fn(() => 1);
  vi.stubGlobal('requestAnimationFrame', requestFrame);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const { rerender } = render(<Fixture containerKey="old" initialIds={['b']} />);
  const original = screen.getByText('A');
  const start = { pointerType: 'mouse', button: 0, ctrlKey: true, clientX: 20, clientY: 0 };
  fireEvent.pointerDown(original, start);
  expect(fireEvent.dragStart(original)).toBe(false);

  rerender(<Fixture containerKey="new" />);
  fireEvent.pointerMove(document, { clientX: 20, clientY: 25 });
  fireEvent.pointerUp(document);
  expect(requestFrame).not.toHaveBeenCalled();
  expect(screen.getByTestId('ids').textContent).toBe('b');

  const label = screen.getByText('A');
  const row = label.closest('[data-row-id]')!;
  expect(label).not.toBe(original);
  vi.spyOn(row.parentElement!, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 100, bottom: 100 } as DOMRect);
  vi.spyOn(row, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 10, right: 30, bottom: 30 } as DOMRect);
  fireEvent.pointerDown(label, start);
  expect(fireEvent.dragStart(original)).toBe(true);
  expect(fireEvent.dragStart(label)).toBe(false);
  fireEvent.pointerMove(document, { clientX: 20, clientY: 25 });
  fireEvent.pointerUp(document);
  expect(screen.getByTestId('ids').textContent).toBe('b,a');
  expect(screen.queryByTestId('rectangle')).toBeNull();
});

it('clips rectangle selection to the scroll viewport so hidden assets stay unselected', () => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  render(<Fixture />);
  const rows = ['A', 'B'].map((name) => screen.getByText(name).closest('[data-row-id]')!);
  vi.spyOn(rows[0]!.parentElement!, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 100, bottom: 100 } as DOMRect);
  rows.forEach((row, index) => {
    vi.spyOn(row, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ left: 10, right: 90, top: 10 + index * 110, bottom: 30 + index * 110 } as DOMRect);
  });
  fireEvent.pointerDown(rows[0]!, { pointerType: 'mouse', button: 0, ctrlKey: true, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(document, { clientX: 95, clientY: 160 });
  fireEvent.pointerUp(document);
  expect(screen.getByTestId('ids').textContent).toBe('a');
});

it('starts only inside its selection surface and ignores excluded child surfaces', () => {
  render(<Fixture startSelector='[data-row-id="a"]' excludeSelector='[data-row-id="b"]' />);
  const a = screen.getByText('A').closest('[data-row-id]')!;
  const b = screen.getByText('B').closest('[data-row-id]')!;
  fireEvent.pointerDown(b, { pointerType: 'mouse', button: 0, ctrlKey: true, clientX: 0, clientY: 0 });
  const drag = new Event('dragstart', { bubbles: true, cancelable: true });
  b.dispatchEvent(drag);
  expect(drag.defaultPrevented).toBe(false);
  fireEvent.pointerDown(a, { pointerType: 'mouse', button: 0, ctrlKey: true, clientX: 0, clientY: 0 });
  const activeDrag = new Event('dragstart', { bubbles: true, cancelable: true });
  a.dispatchEvent(activeDrag);
  expect(activeDrag.defaultPrevented).toBe(true);
  fireEvent.pointerUp(document);
});

it('leaves plain row drags and modified gestures on other controls to the browser', () => {
  render(<Fixture />);
  const label = screen.getByText('A');
  const checkbox = screen.getByRole('checkbox', { name: 'Select A' });
  const actions = screen.getByRole('button', { name: 'Actions' });
  for (const [target, modifier] of [
    [label, { shiftKey: true }],
    [checkbox, { ctrlKey: true }],
    [actions, { metaKey: true }],
  ] as const) {
    fireEvent.pointerDown(target, { pointerType: 'mouse', button: 0, ...modifier });
    expect(fireEvent.dragStart(target)).toBe(true);
    fireEvent.pointerUp(document);
  }

  fireEvent.pointerDown(label, { pointerType: 'mouse', button: 0, metaKey: true });
  fireEvent.pointerUp(document);
  fireEvent.click(label, { metaKey: true });
  expect(screen.getByTestId('ids').textContent).toBe('clicked');
});
