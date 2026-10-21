import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InspectorFields } from '@modules/importer-preview/AssetReviewQueue/components/InspectorFields';
import { SensitiveValue } from '@modules/import/domain/import-model';
import type { ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';

afterEach(cleanup);

it('separates visible plan notes from protected secret fields', () => {
  const asset: ReviewAsset = {
    id: 'asset-1',
    name: 'Account',
    type: 'USERNAME-AND-PASSWORD',
    status: 'suggested',
    confidence: '90% confidence',
    rationale: '',
    mapped: [],
    unmapped: [],
    source: 'import',
    alternatives: [],
    schemaFields: [
      { key: 'secret.password', label: 'Password', sourceFieldId: 'password' },
      { key: 'meta.notes', label: 'Notes or guidelines', sourceFieldId: 'notes' },
    ],
  };

  render(
    <InspectorFields
      asset={asset}
      resolveSourceValue={(id) =>
        new SensitiveValue(id === 'notes' ? 'First line\nSecond line' : 'secret')
      }
    />,
  );

  expect(screen.getByText('Notes or guidelines')).toBeTruthy();
  expect(document.querySelector('.asset-metadata-preview')?.textContent).toBe(
    'First line\nSecond line',
  );
  expect(screen.queryByText('secret')).toBeNull();
  expect(screen.getByRole('button', { name: 'Reveal Password value' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Reveal Notes or guidelines value' })).toBeNull();
});

it('shows fallback notes separately from the plain text secret and allows remapping', () => {
  const asset: ReviewAsset = {
    id: 'asset-2',
    name: 'Imported text',
    type: 'PLAIN-TEXT',
    status: 'fallback',
    rationale: '',
    mapped: [],
    unmapped: [],
    source: 'import',
    alternatives: [],
    plainTextValue: new SensitiveValue('secret body'),
    schemaFields: [
      { key: 'secret.text', label: 'Plain text', sourceFieldId: 'text' },
      {
        key: 'meta.notes',
        label: 'Notes or guidelines',
        sourceFieldId: 'notes',
        sourceFieldName: 'notes',
        candidates: [{ id: 'notes', name: 'notes' }],
      },
    ],
  };
  const mapped: Array<[string, string | undefined]> = [];

  render(
    <InspectorFields
      asset={asset}
      resolveSourceValue={(id) =>
        new SensitiveValue(id === 'notes' ? 'Helpful note' : 'secret body')
      }
      onMapField={(_asset, target, source) => mapped.push([target, source])}
    />,
  );

  expect(screen.getByText('Helpful note')).toBeTruthy();
  expect(screen.getByText('Notes or guidelines')).toBeTruthy();
  expect(screen.queryByText('secret body')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'Remove Notes or guidelines from this Asset' }),
  );
  expect(mapped).toEqual([['meta.notes', undefined]]);
});

it('keeps unmapped notes compact until a source is chosen', () => {
  const asset: ReviewAsset = {
    id: 'asset-3',
    name: 'Imported text',
    type: 'PLAIN-TEXT',
    status: 'fallback',
    rationale: '',
    mapped: [],
    unmapped: [],
    source: 'import',
    alternatives: [],
    schemaFields: [
      { key: 'secret.text', label: 'Plain text', sourceFieldId: 'text' },
      {
        key: 'meta.notes',
        label: 'Notes or guidelines',
        candidates: [{ id: 'notes', name: 'notes' }],
      },
    ],
  };
  const mapped: string[] = [];
  render(
    <InspectorFields
      asset={asset}
      onMapField={(_asset, _target, source) => {
        if (source) mapped.push(source);
      }}
    />,
  );

  expect(screen.getAllByText('Notes or guidelines')).toHaveLength(1);
  expect(screen.queryByText('Not included')).toBeNull();
  expect(screen.queryByText(/Visible outside the protected secret/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Choose Notes or guidelines source field' }));
  fireEvent.click(screen.getByRole('button', { name: 'Map Notes or guidelines to notes' }));
  expect(mapped).toEqual(['notes']);
});
