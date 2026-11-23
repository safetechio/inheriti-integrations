// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { OperationErrors } from '@modules/importer-preview/AssetReviewQueue/components/FieldOperationModal/components/OperationErrors';

afterEach(cleanup);

it('groups repeated validation while retaining every affected entry', () => {
  render(
    <OperationErrors
      entryNames={['First', 'Second']}
      errors={[
        'First: Already proposed.',
        'Second: Already proposed.',
        'First: Already proposed.',
        'Another validation.',
      ]}
    />,
  );
  expect(screen.getAllByText('Already proposed.')).toHaveLength(1);
  expect(screen.getByText('Another validation.')).toBeTruthy();
  expect(screen.queryByText('First · Second')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show 2 affected entries' }));
  expect(screen.getByText('First · Second')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Hide 2 affected entries' }));
  expect(screen.queryByText('First · Second')).toBeNull();
});
