import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BaseModal } from '@main-components';
import { SourceFieldPicker } from '@modules/importer-preview/AssetReviewQueue/components/SourceFieldPicker';

afterEach(cleanup);

it('closes the choices on Escape inside a modal and returns focus to the toggle', async () => {
  const onDismiss = vi.fn();
  const onChange = vi.fn();
  render(
    <BaseModal visible title="Create asset" onDismiss={onDismiss}>
      <SourceFieldPicker
        field={{
          key: 'secret.apiKey',
          label: 'API key',
          sourceFieldId: 'token',
          sourceFieldName: 'Token',
          candidates: [
            { id: 'token', name: 'Token' },
            { id: 'endpoint', name: 'Endpoint' },
          ],
        }}
        onChange={onChange}
      />
    </BaseModal>,
  );
  await Promise.resolve();
  const toggle = screen.getByRole('button', { name: 'Change API key source field' });
  fireEvent.click(toggle);
  const candidate = screen.getByRole('button', { name: 'Map API key to Endpoint' });
  candidate.focus();

  fireEvent.keyDown(candidate, { key: 'Escape' });

  expect(screen.queryByRole('group', { name: 'API key source fields' })).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Create asset' })).toBeTruthy();
  expect(document.activeElement).toBe(toggle);
  expect(onChange).not.toHaveBeenCalled();
  expect(onDismiss).not.toHaveBeenCalled();

  fireEvent.keyDown(toggle, { key: 'Escape' });
  expect(onDismiss).toHaveBeenCalledOnce();
});
