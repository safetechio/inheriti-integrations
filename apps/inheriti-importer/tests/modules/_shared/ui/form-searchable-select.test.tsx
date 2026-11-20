// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FormSearchableSelect } from '@main-components';

afterEach(cleanup);

const options = [
  { value: '', label: 'Organisation root' },
  { value: 'finance', label: 'Organisation root / Finance' },
  { value: 'payroll', label: 'Organisation root / Finance / Payroll' },
  { value: 'ops', label: 'Organisation root / Operations' },
];
const field = () => screen.getByRole<HTMLInputElement>('combobox', { name: 'Destination' });

it('focuses the search and opens the options at mount when requested', () => {
  render(<FormSearchableSelect label="Destination" value="" options={options} onChange={vi.fn()} autoFocus />);
  expect(document.activeElement).toBe(field());
  expect(field().value).toBe('');
  expect(screen.getAllByRole('option')).toHaveLength(options.length);
});

it('searches full folder paths without committing until a keyboard choice', () => {
  const onChange = vi.fn();
  render(<FormSearchableSelect label="Destination" value="ops" options={options} onChange={onChange} />);
  fireEvent.click(field());
  fireEvent.change(field(), { target: { value: '  FINANCE  ' } });

  const [finance, payroll] = screen.getAllByRole('option');
  expect(finance.textContent).toBe(options[1].label);
  expect(payroll.textContent).toBe(options[2].label);
  expect(onChange).not.toHaveBeenCalled();

  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  expect(field().getAttribute('aria-activedescendant')).toBe(finance.id);
  fireEvent.keyDown(field(), { key: 'ArrowDown' });
  expect(field().getAttribute('aria-activedescendant')).toBe(payroll.id);
  fireEvent.keyDown(field(), { key: 'ArrowUp' });
  expect(field().getAttribute('aria-activedescendant')).toBe(finance.id);
  fireEvent.keyDown(field(), { key: 'Enter' });

  expect(onChange).toHaveBeenCalledExactlyOnceWith('finance');
  expect(screen.queryByRole('listbox')).toBeNull();
});

it('keeps Escape inside the popup and restores the current selection', () => {
  const onChange = vi.fn();
  const parentKeydown = vi.fn();
  document.addEventListener('keydown', parentKeydown);
  try {
    render(<FormSearchableSelect label="Destination" value="payroll" options={options} onChange={onChange} />);
    fireEvent.click(field());
    fireEvent.change(field(), { target: { value: 'missing' } });
    expect(screen.getByRole('status').textContent).toBe('No matching folders.');
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    parentKeydown.mockClear();
    fireEvent.keyDown(field(), { key: 'Escape' });

    expect(parentKeydown).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(field().value).toBe(options[2].label);
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(parentKeydown).toHaveBeenCalledOnce();
  } finally {
    document.removeEventListener('keydown', parentKeydown);
  }
});

it.each(['before', 'after'])('keeps the layout stable when focus moves %s pointer release', (timing) => {
  const onChange = vi.fn();
  const onCancel = vi.fn(() => expect(screen.getByRole('listbox')).toBeTruthy());
  render(
    <>
      <FormSearchableSelect label="Destination" value="ops" options={options} onChange={onChange} />
      <button type="button" onClick={onCancel}>Cancel</button>
    </>,
  );
  fireEvent.click(field());
  const cancel = screen.getByRole('button', { name: 'Cancel' });
  fireEvent.pointerDown(cancel);
  if (timing === 'after') fireEvent.pointerUp(cancel);
  fireEvent.blur(field(), { relatedTarget: cancel });
  expect(screen.getByRole('listbox')).toBeTruthy();
  if (timing === 'before') fireEvent.pointerUp(cancel);
  fireEvent.click(cancel);
  expect(onCancel).toHaveBeenCalledOnce();
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});

it('dismisses on blur and supports choosing the organisation root', () => {
  const onChange = vi.fn();
  render(<FormSearchableSelect label="Destination" value="ops" options={options} onChange={onChange} />);
  fireEvent.click(field());
  fireEvent.blur(field());
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(onChange).not.toHaveBeenCalled();

  fireEvent.click(field());
  expect(screen.getByRole('option', { selected: true }).textContent).toBe(options[3].label);
  fireEvent.click(screen.getByRole('option', { name: 'Organisation root' }));
  expect(onChange).toHaveBeenCalledExactlyOnceWith('');
});

it('leaves a removed selection blank and disables input actions', () => {
  const onChange = vi.fn();
  const select = (disabled: boolean) => (
    <FormSearchableSelect label="Destination" value="removed" options={options} onChange={onChange} disabled={disabled} />
  );
  const { rerender } = render(select(false));
  expect(field().value).toBe('');
  fireEvent.keyDown(field(), { key: 'ArrowUp' });
  expect(screen.queryByRole('option', { selected: true })).toBeNull();

  rerender(select(true));
  expect(field().disabled).toBe(true);
  fireEvent.click(field());
  fireEvent.keyDown(field(), { key: 'Enter' });
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  rerender(select(false));
  expect(screen.queryByRole('listbox')).toBeNull();
});
