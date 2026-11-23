// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ImportCoverage } from '@modules/importer-preview/AssetReviewQueue/components/ImportCoverage';
import type { ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';

afterEach(cleanup);

it('separates proposed fields from unassigned fields and opens the exact mapping owner', () => {
  const owner: ReviewAsset = {
    id: 'account',
    sourceId: 'source',
    sourceNodeId: 'entry',
    name: 'Account',
    source: 'Vault.json',
    type: 'USER-PSWD',
    status: 'needs-review',
    mapped: [],
    unmapped: ['Region'],
    rationale: '',
    alternatives: [],
    schemaFields: [{ key: 'secret.username', label: 'Username', sourceFieldId: 'user' }],
  };
  const onReviewMapping = vi.fn();
  render(
    <ImportCoverage
      reviewAssets={[owner]}
      onReviewMapping={onReviewMapping}
      sourceNames={new Map([['source', 'Vault.json']])}
      assetNames={new Map([['account', 'Account']])}
      coverage={{
        ready: false,
        diagnostics: [],
        fields: [
          {
            id: 'user',
            name: 'Username',
            sourceId: 'source',
            nodeId: 'entry',
            status: 'pending',
            destinations: [],
          },
          {
            id: 'region',
            name: 'Region',
            sourceId: 'source',
            nodeId: 'entry',
            status: 'pending',
            destinations: [],
          },
        ],
      }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'View source field details' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.queryByRole('button', { name: 'Show Pending fields' })).toBeNull();
  expect(dialog.getByRole('button', { name: 'Show Proposed fields' }).textContent).toBe(
    'Proposed1',
  );
  expect(dialog.getByRole('button', { name: 'Show Unassigned fields' }).textContent).toBe(
    'Unassigned1',
  );
  fireEvent.click(dialog.getByRole('button', { name: 'Show Unassigned fields' }));
  expect(dialog.queryByText('Username')).toBeNull();
  expect(dialog.getByText('Region')).toBeTruthy();
  fireEvent.click(dialog.getByRole('button', { name: 'Show Proposed fields' }));
  expect(dialog.getByText('Username')).toBeTruthy();
  expect(dialog.queryByText('Region')).toBeNull();
  fireEvent.click(dialog.getByRole('button', { name: 'Review mapping' }));
  expect(onReviewMapping).toHaveBeenCalledWith(owner);
  expect(screen.queryByRole('dialog')).toBeNull();
});
