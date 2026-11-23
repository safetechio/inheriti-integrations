// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Alert, Button } from '@main-components';

afterEach(cleanup);

it('keeps existing alerts dismissable by default', () => {
  render(<Alert>Existing warning</Alert>);
  const alert = screen.getByRole('alert');
  fireEvent.click(alert.querySelector('[aria-label="Dismiss alert"]')!);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('renders an optional action inside a compact, persistent alert', () => {
  const onPress = vi.fn();
  render(
    <Alert
      tone="warning"
      compact
      dismissable={false}
      action={<Button title="Review field" onPress={onPress} />}
    >
      Review the highlighted value.
    </Alert>,
  );
  const alert = screen.getByRole('alert');
  const action = within(alert).getByRole('button', { name: 'Review field' });
  action.focus();
  expect(document.activeElement).toBe(action);
  fireEvent.keyDown(action, { key: 'Enter' });
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(alert.querySelector('[aria-label="Dismiss alert"]')).toBeNull();
});
