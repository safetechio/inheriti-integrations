import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AssetReviewQueue } from '@modules/importer-preview/AssetReviewQueue';
import type { ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';

afterEach(cleanup);

const asset: ReviewAsset = {
  id: 'asset-1',
  name: 'Production database',
  type: 'USER-PSWD',
  status: 'suggested',
  confidence: 'High confidence',
  rationale: 'Matched username and password fields.',
  mapped: ['username', 'password'],
  unmapped: [],
  source: 'prod.kdbx',
  alternatives: ['PLAIN-TEXT'],
};

describe('AssetReviewQueue keyboard shortcuts', () => {
  it('opens unresolved work by default and explains an empty import', () => {
    const accepted = {
      ...asset,
      id: 'asset-2',
      name: 'Accepted Asset',
      status: 'accepted' as const,
    };
    const { unmount } = render(<AssetReviewQueue assets={[asset, accepted]} />);
    expect(screen.queryByText('Accepted Asset')).toBeNull();

    unmount();
    render(<AssetReviewQueue assets={[]} />);
    expect(screen.getByText(/No Assets were detected/)).toBeTruthy();
  });

  it('accepts with an unmodified A key press', () => {
    const onAction = vi.fn();
    render(<AssetReviewQueue assets={[asset]} onAction={onAction} onSelect={vi.fn()} />);

    fireEvent.keyDown(window, { key: 'a' });

    expect(onAction).toHaveBeenCalledWith('accept', asset);
  });

  it('ignores browser, operating-system, composition, and repeated key commands', () => {
    const onAction = vi.fn();
    render(<AssetReviewQueue assets={[asset]} onAction={onAction} onSelect={vi.fn()} />);

    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'a', metaKey: true });
    fireEvent.keyDown(window, { key: 'x', altKey: true });
    fireEvent.keyDown(window, { key: 'a', isComposing: true });
    fireEvent.keyDown(window, { key: 'a', repeat: true });

    expect(onAction).not.toHaveBeenCalled();
  });

  it('keeps search while switching status filters and scopes assets by source', () => {
    const other = {
      ...asset,
      id: 'asset-2',
      name: 'Other token',
      source: 'staging.env',
      sourceFileName: 'staging.env',
      status: 'accepted' as const,
    };
    render(<AssetReviewQueue assets={[{ ...asset, sourceFileName: 'prod.kdbx' }, other]} />);
    fireEvent.click(screen.getByLabelText('Search assets'));
    fireEvent.change(screen.getByLabelText('Search assets'), { target: { value: 'Other' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accepted 1' }));
    expect(screen.getByLabelText('Inspect Other token')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Filter by source'), { target: { value: 'prod.kdbx' } });
    expect(screen.queryByLabelText('Inspect Other token')).toBeNull();
    fireEvent.click(screen.getByLabelText('Clear asset search'));
    expect((screen.getByLabelText('Search assets') as HTMLInputElement).value).toBe('');
  });

  it('shows a collapsed tree only for a source with real folders', () => {
    render(
      <AssetReviewQueue
        assets={[
          { ...asset, sourceFileName: 'prod.kdbx', folderPath: ['Infrastructure', 'Database'] },
        ]}
      />,
    );
    fireEvent.change(screen.getByLabelText('Filter by source'), { target: { value: 'prod.kdbx' } });
    expect(screen.getByLabelText('list')).toBeTruthy();
    expect(screen.getByLabelText('sitemap')).toBeTruthy();
    fireEvent.click(screen.getByText('Tree'));
    expect(screen.queryByLabelText('Inspect Production database')).toBeNull();
    fireEvent.click(screen.getByText(/Infrastructure/));
    fireEvent.click(screen.getByText(/Database/));
    expect(screen.getByLabelText('Inspect Production database')).toBeTruthy();
  });

  it('disables the decision already made while allowing the opposite decision', () => {
    const accepted = { ...asset, status: 'accepted' as const };
    render(<AssetReviewQueue assets={[accepted]} onAction={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Exclude' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
