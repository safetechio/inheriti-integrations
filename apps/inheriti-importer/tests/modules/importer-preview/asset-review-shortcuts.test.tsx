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
});
