import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssetReviewQueue, type ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';
import { SensitiveValue } from '@modules/import/domain/import-model';

afterEach(cleanup);

function asset(sourceFieldId: string | undefined = 'source:token', id = 'asset-1'): ReviewAsset {
  return {
    id,
    name: 'Partner integration',
    type: 'API-KEY',
    status: 'needs-review',
    confidence: '53% confidence',
    rationale: 'A token-like field was detected.',
    mapped: [],
    unmapped: [],
    source: 'staging.env · PARTNER_API',
    alternatives: [],
    schemaFields: [
      {
        key: 'secret.apiKey',
        label: 'API key',
        sourceFieldId,
        sourceFieldName: sourceFieldId ? 'token' : undefined,
        candidates: [
          { id: 'source:token', name: 'token' },
          { id: 'source:endpoint', name: 'endpoint' },
        ],
      },
    ],
  };
}

describe('Asset schema mapping', () => {
  it('keeps plain text masked until reveal and omits numeric confidence', async () => {
    const onEditPlainText = vi.fn();
    render(
      <AssetReviewQueue
        assets={[
          {
            ...asset(),
            type: 'PLAIN-TEXT',
            suggestionLabel: 'Plain Text fallback',
            plainTextValue: new SensitiveValue('username: octo\npassword: secret'),
          },
        ]}
        onAction={vi.fn()}
        onEditPlainText={onEditPlainText}
      />,
    );

    expect(
      screen.getByDisplayValue('•'.repeat('username: octo\npassword: secret'.length)),
    ).toBeTruthy();
    expect(screen.queryByText('53% confidence')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal plain text' }));
    expect(screen.getByRole('button', { name: 'Hide plain text' })).toBeTruthy();
    const editor = screen.getByLabelText('Plain text value') as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toBe('username: octo\npassword: secret'));
    fireEvent.change(editor, { target: { value: 'edited' } });
    expect(onEditPlainText).toHaveBeenCalledWith(expect.anything(), 'edited');
  });

  it('resolves composite Plain Text sources only after reveal', async () => {
    const resolveSourceValue = vi
      .fn()
      .mockReturnValueOnce(new SensitiveValue('octo'))
      .mockReturnValueOnce(new SensitiveValue('secret'));
    render(
      <AssetReviewQueue
        assets={[
          {
            ...asset(),
            type: 'PLAIN-TEXT',
            plainTextSources: [
              { id: 'user', name: 'username' },
              { id: 'pass', name: 'password' },
            ],
          },
        ]}
        onAction={vi.fn()}
        resolveSourceValue={resolveSourceValue}
        onEditPlainText={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue('••••••••')).toBeTruthy();
    expect(resolveSourceValue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal plain text' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Plain text value') as HTMLTextAreaElement).value).toBe(
        'username: octo\npassword: secret',
      ),
    );
    expect(resolveSourceValue).toHaveBeenCalledTimes(2);
  });

  it('shows a single Plain Text source as its raw value without source controls', async () => {
    const resolveSourceValue = vi.fn(() => new SensitiveValue('development'));
    render(
      <AssetReviewQueue
        assets={[
          {
            ...asset(),
            type: 'PLAIN-TEXT',
            schemaFields: [
              {
                key: 'secret.text',
                label: 'Text',
                sourceFieldId: 'field-value',
                candidates: [{ id: 'field-value', name: 'extra:NODE_ENV' }],
              },
            ],
          },
        ]}
        onAction={vi.fn()}
        onEditPlainText={vi.fn()}
        resolveSourceValue={resolveSourceValue}
      />,
    );

    expect(screen.queryByText('Value source')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use one imported field' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal plain text' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Plain text value') as HTMLTextAreaElement).value).toBe(
        'development',
      ),
    );
  });

  it('lets the user replace the Plain Text fallback with one imported value', async () => {
    const onMapField = vi.fn();
    const resolveSourceValue = vi.fn(() => new SensitiveValue('ff_live_9f3a7c2b1e0d'));
    render(
      <AssetReviewQueue
        assets={[
          {
            ...asset(),
            type: 'PLAIN-TEXT',
            plainTextSources: [
              { id: 'field-key', name: 'extra:API_KEY' },
              { id: 'field-secret', name: 'extra:API_SECRET' },
            ],
            schemaFields: [
              {
                key: 'secret.text',
                label: 'Text',
                candidates: [
                  { id: 'field-key', name: 'extra:API_KEY' },
                  { id: 'field-secret', name: 'extra:API_SECRET' },
                ],
              },
            ],
          },
        ]}
        onAction={vi.fn()}
        onMapField={onMapField}
        resolveSourceValue={resolveSourceValue}
      />,
    );

    expect(screen.getByText('All imported fields')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use one imported field' }));
    const picker = screen.getByLabelText('Choose imported field') as HTMLSelectElement;
    expect(picker.querySelector('option[value="field-key"]')?.textContent).toBe('API_KEY');
    fireEvent.change(picker, { target: { value: 'field-key' } });
    expect(onMapField).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'asset-1' }),
      'secret.text',
      'field-key',
    );
  });

  it('hides source controls for edited Plain Text with one imported field', () => {
    render(
      <AssetReviewQueue
        assets={[
          {
            ...asset(),
            type: 'PLAIN-TEXT',
            plainTextValue: new SensitiveValue('edited'),
            schemaFields: [
              {
                key: 'secret.text',
                label: 'Text',
                candidates: [{ id: 'field-key', name: 'extra:API_KEY' }],
              },
            ],
          },
        ]}
        onAction={vi.fn()}
      />,
    );

    expect(screen.queryByText('Value source')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use all imported fields' })).toBeNull();
  });

  it('offers restore only for a converted Plain Text asset', () => {
    const onAction = vi.fn();
    render(
      <AssetReviewQueue
        assets={[
          {
            ...asset(),
            type: 'PLAIN-TEXT',
            plainTextSources: [{ id: 'token', name: 'token' }],
            convertedFromType: 'API-KEY',
          },
        ]}
        onAction={onAction}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back to suggested API Key' }));
    expect(onAction).toHaveBeenCalledWith('restore-suggestion', expect.anything());
  });

  it('only offers Plain Text as a classification override', () => {
    render(
      <AssetReviewQueue
        assets={[
          {
            ...asset(),
            alternatives: ['PRIVATE-KEY', 'PLAIN-TEXT'],
          },
        ]}
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Use Plain Text instead' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Private Key' })).toBeNull();
  });

  it('blocks a whitespace-only Plain Text secret', () => {
    render(
      <AssetReviewQueue
        assets={[
          {
            ...asset(),
            type: 'PLAIN-TEXT',
            plainTextValue: new SensitiveValue('   '),
            schemaFields: [
              {
                key: 'secret.text',
                label: 'Text',
                validationError: 'Please fill in this field',
              },
            ],
          },
        ]}
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByText('Please fill in this field')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Accept as Plain Text' }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('resolves a protected value only while the user has revealed it', () => {
    const resolveSourceValue = vi.fn(() => new SensitiveValue('protected-example'));
    const onAction = vi.fn();
    const { rerender } = render(
      <AssetReviewQueue
        assets={[asset()]}
        onAction={onAction}
        resolveSourceValue={resolveSourceValue}
      />,
    );

    expect(screen.getByText('••••••••')).toBeTruthy();
    expect(resolveSourceValue).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Reveal API key value' }));
    expect(resolveSourceValue).toHaveBeenCalledWith('source:token');
    expect(screen.getByText('protected-example')).toBeTruthy();

    rerender(
      <AssetReviewQueue
        assets={[asset('source:token', 'asset-2')]}
        onAction={onAction}
        resolveSourceValue={resolveSourceValue}
      />,
    );
    expect(screen.queryByText('protected-example')).toBeNull();
    expect(screen.getByText('••••••••')).toBeTruthy();
    expect(resolveSourceValue).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Reveal API key value' }));
    rerender(
      <AssetReviewQueue
        assets={[asset('source:endpoint', 'asset-2')]}
        onAction={onAction}
        resolveSourceValue={resolveSourceValue}
      />,
    );
    expect(screen.queryByText('protected-example')).toBeNull();
    expect(screen.getByText('••••••••')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reveal API key value' }));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.queryByText('protected-example')).toBeNull();
    expect(screen.getByText('••••••••')).toBeTruthy();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  it('emits canonical target-to-source mapping changes without carrying values', () => {
    const onMapField = vi.fn();
    render(<AssetReviewQueue assets={[asset()]} onAction={vi.fn()} onMapField={onMapField} />);

    fireEvent.click(screen.getByLabelText('Change API key source field'));
    fireEvent.click(screen.getByLabelText('Map API key to endpoint'));
    expect(onMapField).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'asset-1' }),
      'secret.apiKey',
      'source:endpoint',
    );

    fireEvent.click(screen.getByLabelText('Remove API key from this Asset'));
    expect(onMapField).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'asset-1' }),
      'secret.apiKey',
      undefined,
    );
  });

  it('hides internal extra-field prefixes from source labels', () => {
    const imported = asset('source:token');
    imported.schemaFields![0]!.sourceFieldName = 'extra:API_KEY';
    imported.schemaFields![0]!.candidates = [
      { id: 'source:token', name: 'extra:API_KEY' },
      { id: 'source:endpoint', name: 'extra:API_SECRET' },
    ];
    render(<AssetReviewQueue assets={[imported]} onAction={vi.fn()} onMapField={vi.fn()} />);

    expect(screen.getByText('API_KEY')).toBeTruthy();
    expect(screen.queryByText('extra:API_KEY')).toBeNull();
    fireEvent.click(screen.getByLabelText('Change API key source field'));
    expect(screen.getByLabelText('Map API key to API_SECRET')).toBeTruthy();
  });

  it('blocks acceptance when no schema field is included', () => {
    const onAction = vi.fn();
    render(<AssetReviewQueue assets={[asset('')]} onAction={onAction} />);

    expect(
      screen.getByText('Include at least one schema field before accepting this Asset.'),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Accept as API Key' }).getAttribute('aria-disabled'),
    ).toBe('true');
    fireEvent.keyDown(window, { key: 'a' });
    expect(onAction).not.toHaveBeenCalled();
  });
});
