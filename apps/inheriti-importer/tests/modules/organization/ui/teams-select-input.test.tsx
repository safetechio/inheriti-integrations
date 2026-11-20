// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { TeamsSelectInput } from '@modules/organization/ui/components/TeamsSelectInput';

afterEach(cleanup);

const teams = [
  { id: 'ops', name: 'Operations' },
  { id: 'finance', name: 'Finance' },
];

it('filters options, keeps the list open on selection, and removes teams by chip', () => {
  const change = vi.fn();
  function Picker() {
    const [ids, setIds] = useState(['existing-team']);
    return <TeamsSelectInput teams={teams} selectedIds={ids} onChange={(next) => {
      change(next);
      setIds(next);
    }} />;
  }
  render(<Picker />);
  const search = screen.getByRole('textbox', { name: 'Search teams' });
  expect(screen.queryByRole('checkbox')).toBeNull();

  fireEvent.focus(search);
  fireEvent.change(search, { target: { value: '  OPER  ' } });
  expect(screen.queryByRole('checkbox', { name: 'Finance' })).toBeNull();
  const operations = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Operations' });
  fireEvent.click(operations);
  expect(operations.checked).toBe(true);
  expect(change).toHaveBeenLastCalledWith(['existing-team', 'ops']);

  fireEvent.change(search, { target: { value: 'none' } });
  expect(screen.getByRole('status').textContent).toBe('No matching teams.');
  fireEvent.click(screen.getByRole('button', { name: 'Remove Operations' }));
  expect(change).toHaveBeenLastCalledWith(['existing-team']);

  fireEvent.click(document.body);
  expect(screen.queryByRole('group', { name: 'Available teams' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Remove existing-team' }));
  expect(change).toHaveBeenLastCalledWith([]);
});

it('disables search, options, and chip removal while saving', () => {
  const onChange = vi.fn();
  const props = { teams, selectedIds: ['ops'], onChange };
  const { rerender } = render(<TeamsSelectInput {...props} />);
  fireEvent.focus(screen.getByRole('textbox', { name: 'Search teams' }));
  rerender(<TeamsSelectInput {...props} disabled />);

  expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Search teams' }).disabled).toBe(true);
  const option = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Finance' });
  expect(option.disabled).toBe(true);
  const remove = screen.getByRole('button', { name: 'Remove Operations' });
  expect(remove.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(remove);
  expect(onChange).not.toHaveBeenCalled();
});

it('shows loading, retry, and resolved-empty states separately', () => {
  const onRetry = vi.fn();
  const props = { teams: [], selectedIds: [], onChange: vi.fn(), onRetry };
  const { rerender } = render(<TeamsSelectInput {...props} loading />);
  expect(screen.getByRole('status', { name: 'Loading teams', busy: true })).toBeTruthy();
  const empty = 'No teams available for this organisation.';
  expect(screen.queryByText(empty)).toBeNull();

  rerender(<TeamsSelectInput {...props} error="Teams could not be loaded." />);
  expect(screen.getByRole('alert').textContent).toBe('Teams could not be loaded.');
  expect(screen.queryByText(empty)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading teams' }));
  expect(onRetry).toHaveBeenCalledOnce();

  rerender(<TeamsSelectInput {...props} />);
  expect(screen.getByText(empty)).toBeTruthy();
});

it('keeps the list open until an outside button receives the click', () => {
  const onCancel = vi.fn(() => {
    expect(screen.getByRole('group', { name: 'Available teams' })).toBeTruthy();
  });
  render(
    <>
      <TeamsSelectInput teams={teams} selectedIds={[]} onChange={vi.fn()} />
      <button onClick={onCancel}>Cancel</button>
    </>,
  );
  const search = screen.getByRole('textbox', { name: 'Search teams' });
  const cancel = screen.getByRole('button', { name: 'Cancel' });
  fireEvent.focus(search);
  fireEvent.pointerDown(cancel);
  fireEvent.blur(search, { relatedTarget: cancel });
  expect(screen.getByRole('group', { name: 'Available teams' })).toBeTruthy();
  fireEvent.pointerUp(cancel);
  fireEvent.click(cancel);
  expect(onCancel).toHaveBeenCalledOnce();
  expect(screen.queryByRole('group', { name: 'Available teams' })).toBeNull();

  fireEvent.focus(search);
  fireEvent.blur(search, { relatedTarget: cancel });
  expect(screen.queryByRole('group', { name: 'Available teams' })).toBeNull();
});
