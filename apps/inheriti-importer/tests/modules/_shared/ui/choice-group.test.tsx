// @vitest-environment happy-dom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ChoiceGroup } from '@main-components';

afterEach(cleanup);

const options = [
  { value: 'private', label: 'Private', description: 'Requires reveal.' },
  { value: 'visible', label: 'Visible' },
  { value: 'unavailable', label: 'Unavailable', disabled: true },
] as const;

function Picker({ label }: { label: string }) {
  const [value, setValue] = useState<(typeof options)[number]['value']>('private');
  return <ChoiceGroup label={label} value={value} options={options} onChange={setValue} />;
}

it('selects a card without changing a second group and exposes disabled options', () => {
  render(
    <>
      <Picker label="First destination" />
      <Picker label="Second destination" />
    </>,
  );
  const first = within(screen.getByRole('radiogroup', { name: 'First destination' }));
  const second = within(screen.getByRole('radiogroup', { name: 'Second destination' }));
  const firstPrivate = first.getByRole<HTMLInputElement>('radio', {
    name: 'Private',
    description: 'Requires reveal.',
  });
  const secondPrivate = second.getByRole<HTMLInputElement>('radio', { name: 'Private' });
  const visible = first.getByRole<HTMLInputElement>('radio', { name: 'Visible' });

  fireEvent.click(visible.closest('label')!);

  expect(firstPrivate.checked).toBe(false);
  expect(visible.checked).toBe(true);
  expect(secondPrivate.checked).toBe(true);
  expect(first.getByRole<HTMLInputElement>('radio', { name: 'Unavailable' }).disabled).toBe(true);
});
