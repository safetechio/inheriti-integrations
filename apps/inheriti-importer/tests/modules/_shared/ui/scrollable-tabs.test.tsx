// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ScrollableTabs } from '@main-components';

afterEach(cleanup);

it('scrolls an overflowing tab row by wheel, drag and arrows while preserving normal clicks', () => {
  const onChange = vi.fn();
  render(
    <ScrollableTabs
      label="Test filters"
      tabs={[
        { value: 'one', label: 'One' },
        { value: 'two', label: 'Two' },
      ]}
      value="one"
      onChange={onChange}
    />,
  );
  const strip = screen.getByRole('group', { name: 'Test filters' });
  Object.defineProperties(strip, {
    clientWidth: { value: 100 },
    scrollWidth: { value: 220 },
  });
  fireEvent.scroll(strip);

  const right = screen.getByRole('button', { name: 'Scroll tabs right' });
  expect(screen.queryByRole('button', { name: 'Scroll tabs left' })).toBeNull();
  expect(fireEvent.wheel(strip, { deltaY: -30 })).toBe(true);
  expect(fireEvent.wheel(strip, { deltaY: 30 })).toBe(false);
  expect(strip.scrollLeft).toBe(30);
  expect(screen.getByRole('button', { name: 'Scroll tabs left' })).toBeTruthy();

  const tab = screen.getByRole('button', { name: 'Two' });
  fireEvent.pointerDown(tab, { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 80 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 40 });
  fireEvent.pointerUp(window, { pointerId: 1 });
  expect(strip.scrollLeft).toBe(70);
  fireEvent.click(tab, { detail: 1 });
  expect(onChange).not.toHaveBeenCalled();

  fireEvent.pointerDown(tab, { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 40 });
  fireEvent.pointerUp(window, { pointerId: 1 });
  fireEvent.click(tab, { detail: 1 });
  expect(onChange).toHaveBeenCalledWith('two');

  right.focus();
  fireEvent.keyDown(right, { key: 'Enter' });
  expect(strip.scrollLeft).toBe(120);
  fireEvent.scroll(strip);
  expect(screen.queryByRole('button', { name: 'Scroll tabs right' })).toBeNull();
  expect(document.activeElement).toBe(strip);
  expect(fireEvent.wheel(strip, { deltaY: 10 })).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: 'Scroll tabs left' }));
  expect(strip.scrollLeft).toBe(45);
});
