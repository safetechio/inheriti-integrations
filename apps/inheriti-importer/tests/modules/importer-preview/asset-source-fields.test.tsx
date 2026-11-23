// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AssetReviewQueue, type ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';
import type { SourceCoverage } from '@modules/mapping/application/source-coverage';

afterEach(cleanup);

const account: ReviewAsset = {
  id: 'account',
  sourceId: 'source',
  sourceNodeId: 'entry',
  source: 'Work.1pux',
  name: 'Work account',
  type: 'USER-PSWD',
  status: 'accepted',
  rationale: '',
  mapped: [],
  unmapped: [],
  unmappedSourceFieldIds: Array.from({ length: 7 }, (_, index) => `local-${index}`),
  alternatives: [],
  schemaFields: [{ key: 'secret.username', label: 'Username', sourceFieldId: 'login' }],
};
const entry = { sourceId: 'source', nodeId: 'entry' };
const unmapped = ['Recovery code', 'Region', 'Account ID', 'Role', 'Token', 'Device', 'Backup'];
const coverage: SourceCoverage = {
  fields: [
    {
      ...entry,
      id: 'login',
      name: 'Login',
      status: 'mapped',
      destinations: [{ assetId: 'account', fieldId: 'secret.username', valid: true }],
    },
    ...unmapped.map((name, index) => ({
      ...entry,
      id: `local-${index}`,
      name: index === 0 ? `extra:${name}` : name,
      status: index === 0 ? ('invalid' as const) : ('pending' as const),
      destinations:
        index === 0 ? [{ assetId: 'account', fieldId: 'secret.email', valid: false }] : [],
    })),
    { ...entry, id: 'excluded', name: 'Archived PIN', status: 'excluded', destinations: [] },
    {
      ...entry,
      sourceId: 'other-source',
      id: 'other-source-field',
      name: 'Recovery code',
      status: 'pending',
      destinations: [],
    },
    {
      ...entry,
      nodeId: 'other-entry',
      id: 'other-entry-field',
      name: 'Recovery code',
      status: 'pending',
      destinations: [],
    },
  ],
  diagnostics: [],
  ready: false,
};
const region = () => within(screen.getByRole('region', { name: 'Source fields' }));
const includeRecovery = { name: 'Include in protected text: Recovery code' };

it('shows unresolved source fields first and preserves exact scoped IDs beyond the preview', () => {
  const onPreserveFields = vi.fn((ids: string[]) => ({
    changedIds: ids.slice(0, 1),
    skippedIds: ids.slice(1),
  }));
  const resolveSourceValue = vi.fn();
  render(
    <AssetReviewQueue
      assets={[account]}
      resolveSourceValue={resolveSourceValue}
      preservation={{ coverage, noteSources: [], onPreserveFields }}
    />,
  );
  const fields = region();
  expect(fields.getByText('1 mapped here · 7 pending · 1 excluded')).toBeTruthy();
  expect(fields.getByText('Recovery code')).toBeTruthy();
  expect(fields.queryByText('extra:Recovery code')).toBeNull();
  expect(fields.getByText('Invalid destination — review required')).toBeTruthy();
  expect(fields.queryByText('Backup')).toBeNull();
  expect(fields.queryByText('Mapped · This asset · Username')).toBeNull();
  fireEvent.click(fields.getByRole('button', includeRecovery));
  expect(onPreserveFields).toHaveBeenLastCalledWith(['local-0']);
  const includeAll = fields.getByRole('button', { name: 'Include all unmapped fields' });
  expect(
    includeAll.compareDocumentPosition(fields.getByText('Recovery code')) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fireEvent.click(includeAll);
  expect(onPreserveFields).toHaveBeenLastCalledWith(unmapped.map((_, index) => `local-${index}`));
  expect(fields.getByRole('status').textContent).toBe('1 included in protected text · 6 skipped');
  fireEvent.click(fields.getByRole('button', { name: 'Show all 9 fields' }));
  expect(fields.getByText('Backup')).toBeTruthy();
  expect(fields.getByText('Mapped · This asset · Username')).toBeTruthy();
  expect(fields.getByText('Explicitly excluded from import')).toBeTruthy();
  expect(fields.queryByRole('button', { name: /Archived PIN/ })).toBeNull();
  fireEvent.click(fields.getByRole('button', { name: 'Show fewer fields' }));
  expect(fields.queryByText('Backup')).toBeNull();
  expect(resolveSourceValue).not.toHaveBeenCalled();
});

it('reflects protected and invalid destinations independently and hides actions for excluded assets', () => {
  const onPreserveFields = vi.fn();
  const props = {
    assets: [account],
    preservation: { coverage, noteSources: [], onPreserveFields },
  };
  const { rerender } = render(<AssetReviewQueue {...props} />);
  expect(region().getByRole('button', includeRecovery)).toBeTruthy();
  rerender(
    <AssetReviewQueue
      {...props}
      preservation={{
        ...props.preservation,
        coverage: {
          ...coverage,
          fields: coverage.fields.slice(0, 2).map((field) =>
            field.id === 'local-0'
              ? {
                  ...field,
                  status: 'protected',
                  destinations: [
                    ...field.destinations,
                    { assetId: 'companion', fieldId: 'secret.text', valid: true },
                  ],
                }
              : field,
          ),
        },
      }}
    />,
  );
  expect(region().getByText('Invalid destination · This asset · Email')).toBeTruthy();
  expect(region().getByText('Preserved in an additional asset · Mapped')).toBeTruthy();
  expect(region().getByText('1 mapped here · 1 in additional assets')).toBeTruthy();
  expect(region().queryByRole('button', includeRecovery)).toBeNull();
  rerender(<AssetReviewQueue {...props} assets={[{ ...account, status: 'excluded' }]} />);
  expect(region().queryByRole('button', includeRecovery)).toBeNull();
  expect(region().queryByRole('button', { name: 'Include all unmapped fields' })).toBeNull();
});

it('uses direct destinations for legacy assets without a source node', () => {
  render(
    <AssetReviewQueue
      assets={[{ ...account, sourceNodeId: undefined }]}
      preservation={{ coverage, noteSources: [] }}
    />,
  );
  expect(region().getByText('Mapped · This asset · Username')).toBeTruthy();
  expect(region().getByText('Recovery code')).toBeTruthy();
  expect(region().queryByText('Region')).toBeNull();
});

it('requires explicit unmapped IDs when legacy data has duplicate labels in one entry', () => {
  const duplicates = [
    coverage.fields[1]!,
    { ...coverage.fields[1]!, id: 'duplicate', status: 'pending' as const, destinations: [] },
  ];
  render(
    <AssetReviewQueue
      assets={[
        {
          ...account,
          unmapped: ['Recovery code'],
          unmappedSourceFieldIds: undefined,
        },
      ]}
      preservation={{
        coverage: { ...coverage, fields: duplicates },
        noteSources: [],
        onPreserveFields: vi.fn(),
      }}
    />,
  );
  expect(region().getAllByText('Recovery code')).toHaveLength(2);
  expect(region().queryByRole('button', includeRecovery)).toBeNull();
  expect(region().queryByRole('button', { name: 'Include all unmapped fields' })).toBeNull();
});
