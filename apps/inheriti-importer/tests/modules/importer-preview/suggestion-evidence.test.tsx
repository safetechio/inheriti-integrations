import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Inspector } from '@modules/importer-preview/AssetReviewQueue/components/Inspector';
import type { ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';

const asset: ReviewAsset = {
  id: 'account',
  name: 'Account',
  type: 'API-KEY',
  status: 'suggested',
  source: 'fixture.json',
  sourceId: 'file',
  sourceNodeId: 'entry',
  rationale: '',
  mapped: ['api_key'],
  unmapped: ['region'],
  alternatives: [],
  suggestionEvidence: ['specific-anchor', 'specific-anchor', 'unknown-signal'],
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('shows only known reasons once and resets disclosure when the inspected asset changes', () => {
  const { rerender } = render(<Inspector asset={asset} />);
  const button = screen.getByRole('button', { name: 'Why this suggestion?' });
  expect(button.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(button);
  expect(screen.getAllByText('A specific field name identifies the asset.')).toHaveLength(1);
  expect(screen.getByText('1 mapped · 1 unassigned')).toBeTruthy();
  expect(screen.queryByText('unknown-signal')).toBeNull();
  rerender(<Inspector asset={{ ...asset, id: 'other' }} />);
  expect(screen.queryByText('A specific field name identifies the asset.')).toBeNull();
  expect(screen.getByRole('button', { name: 'Why this suggestion?' }).getAttribute('aria-expanded')).toBe('false');
});

it('keeps the evidence and legacy source-field panels keyed independently', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<Inspector asset={asset} coverage={{
    fields: [{ id: 'region', name: 'region', sourceId: 'file', nodeId: 'entry', status: 'pending', destinations: [] }],
    diagnostics: [], ready: false,
  }} />);
  expect(error.mock.calls.some((call) => String(call[0]).includes('same key'))).toBe(false);
});
