import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Inspector } from '@modules/importer-preview/AssetReviewQueue/components/Inspector';
import type {
  ReviewAsset,
  ReviewAssetField,
} from '@modules/importer-preview/AssetReviewQueue/types';

afterEach(cleanup);

const asset: ReviewAsset = {
  id: 'asset-1',
  name: 'Partner integration',
  type: 'USER-PSWD',
  status: 'needs-review',
  rationale: '',
  mapped: [],
  unmapped: [],
  source: 'staging.env',
  alternatives: [],
};

const username: ReviewAssetField = { key: 'secret.username', label: 'Username' };
const password: ReviewAssetField = {
  key: 'secret.password',
  label: 'Password',
  candidates: [{ id: 'source:password', name: 'password' }],
};

function renderInspector(asset: ReviewAsset) {
  const onAction = vi.fn();
  const onMapField = vi.fn();
  const onEditPlainText = vi.fn();
  const resolveSourceValue = vi.fn();
  render(
    <Inspector
      asset={asset}
      onAction={onAction}
      onMapField={onMapField}
      onEditPlainText={onEditPlainText}
      resolveSourceValue={resolveSourceValue}
    />,
  );
  return { onAction, onMapField, onEditPlainText, resolveSourceValue };
}

function goToField(control: HTMLElement, activation: 'click' | 'keyboard' = 'click') {
  const field = control.closest<HTMLElement>('[data-review-field]')!;
  const scrollIntoView = vi.fn();
  field.scrollIntoView = scrollIntoView;
  expect(document.activeElement).not.toBe(control);
  const action = screen.getByRole('button', { name: 'Go to field' });
  if (activation === 'keyboard') {
    action.focus();
    expect(document.activeElement).toBe(action);
    fireEvent.keyDown(action, { key: 'Enter' });
  } else {
    fireEvent.click(action);
  }
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  expect(document.activeElement).toBe(control);
  expect(screen.getByRole('button', { name: 'Accept' }).getAttribute('aria-disabled')).toBe('true');
}

describe('Acceptance warning focus', () => {
  it('leads to the first secret with an available source without opening or changing it', () => {
    const callbacks = renderInspector({ ...asset, schemaFields: [username, password] });
    expect(
      screen.getByText(
        'Choose a source for at least one secret field before accepting this asset.',
      ),
    ).toBeTruthy();
    goToField(screen.getByRole('button', { name: 'Choose Password source field' }));
    expect(screen.queryByLabelText('Map Password to password')).toBeNull();
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
  });

  it('prioritizes an invalid mapping over a missing required field', () => {
    const callbacks = renderInspector({
      ...asset,
      schemaFields: [
        { ...username, required: true, validationError: 'Please fill in this field' },
        { ...password, sourceFieldId: 'source:password', validationError: 'Invalid password' },
      ],
    });
    expect(
      screen.getByText('Fix the highlighted fields before accepting this asset.'),
    ).toBeTruthy();
    goToField(screen.getByRole('button', { name: 'Change Password source field' }));
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
  });

  it('names the missing required field and focuses its row when it has no candidates', () => {
    renderInspector({
      ...asset,
      schemaFields: [
        { ...username, required: true, validationError: 'Please fill in this field' },
        { ...password, sourceFieldId: 'source:password' },
      ],
    });
    expect(
      screen.getByText('Choose a source for Username before accepting this asset.'),
    ).toBeTruthy();
    goToField(screen.getByText('Username *').closest<HTMLElement>('[data-review-field]')!);
  });

  it('focuses the empty Plain Text editor without editing or revealing a value', () => {
    const callbacks = renderInspector({
      ...asset,
      type: 'PLAIN-TEXT',
      schemaFields: [
        { key: 'secret.text', label: 'Plain text', validationError: 'Please fill in this field' },
      ],
    });
    expect(screen.getByText('Enter a Plain Text secret before accepting this asset.')).toBeTruthy();
    const textbox = screen.getByRole('textbox', {
      name: 'Plain text value',
    }) as HTMLTextAreaElement;
    goToField(textbox, 'keyboard');
    expect(textbox.value).toBe('');
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
  });

  it('focuses the Notes source when a Plain Text asset has a Notes error', () => {
    const callbacks = renderInspector({
      ...asset,
      type: 'PLAIN-TEXT',
      plainTextSources: [{ id: 'source:password', name: 'password' }],
      schemaFields: [
        {
          key: 'meta.notes',
          label: 'Notes',
          validationError: 'Please enter a value of max 500 chars',
          sourceFieldId: 'source:notes',
          candidates: [{ id: 'source:notes', name: 'notes' }],
        },
      ],
    });
    expect(
      screen.getByText('Fix the highlighted fields before accepting this asset.'),
    ).toBeTruthy();
    callbacks.resolveSourceValue.mockClear();
    goToField(screen.getByRole('button', { name: 'Change Notes source field' }));
    expect((screen.getByLabelText('Plain text value') as HTMLTextAreaElement).value).toBe(
      '•••••••',
    );
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
  });
});
