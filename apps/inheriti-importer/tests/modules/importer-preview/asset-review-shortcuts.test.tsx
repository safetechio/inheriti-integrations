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
  it('keeps status tabs above both panes and source controls above the scrolling list', () => {
    const { container } = render(<AssetReviewQueue assets={[asset]} />);
    const surface = container.querySelector('.asset-review-surface')!;
    const columns = container.querySelector('.asset-review-columns')!;
    const leftPane = container.querySelector('.asset-review-list-pane')!;
    expect(surface.firstElementChild).not.toBe(columns);
    expect(surface.lastElementChild).toBe(columns);
    expect(leftPane.parentElement).toBe(columns);
    expect(leftPane.firstElementChild?.classList.contains('asset-review-toolbar')).toBe(true);
    expect(leftPane.lastElementChild?.classList.contains('asset-review-queue')).toBe(true);
    expect(columns.lastElementChild?.classList.contains('asset-review-inspector')).toBe(true);
  });

  it('exposes the full asset name as a native hover title', () => {
    const name = 'Very long synthetic production database credential';
    const { container } = render(<AssetReviewQueue assets={[{ ...asset, name }]} />);
    expect(
      container.querySelector('.asset-review-row-name')?.closest('[title]')?.getAttribute('title'),
    ).toBe(name);
    expect(container.querySelector('.asset-review-row-name')?.nextElementSibling?.textContent).toBe(
      'Username and Password',
    );
  });

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
    const searchIcon = (button: HTMLElement) =>
      button.querySelector('[data-testid]') as HTMLElement;
    expect(searchIcon(screen.getByRole('button', { name: 'Search assets' })).style.color).toBe(
      'rgb(163, 179, 191)',
    );
    fireEvent.click(screen.getByLabelText('Search assets'));
    expect(searchIcon(screen.getByRole('button', { name: 'Close asset search' })).style.color).toBe(
      'rgb(71, 84, 103)',
    );
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
    expect(screen.getByRole('button', { name: 'List' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Tree' }).getAttribute('aria-pressed')).toBe('false');
    const listIcon = screen
      .getByRole('button', { name: 'List' })
      .querySelector('[data-testid]') as HTMLElement;
    const treeIcon = screen
      .getByRole('button', { name: 'Tree' })
      .querySelector('[data-testid]') as HTMLElement;
    expect(listIcon.style.color).toBe('rgb(71, 84, 103)');
    expect(treeIcon.style.color).toBe('rgb(71, 84, 103)');
    expect(screen.queryByText('Tree')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tree' }));
    expect(screen.getByRole('button', { name: 'Tree' }).getAttribute('aria-pressed')).toBe('true');
    expect(treeIcon.style.color).toBe('rgb(71, 84, 103)');
    expect(listIcon.style.color).toBe('rgb(71, 84, 103)');
    expect(screen.queryByLabelText('Inspect Production database')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Database (1)' })).toBeNull();
    const parent = screen.getByRole('button', { name: 'Infrastructure (1)' });
    expect(parent.getAttribute('aria-expanded')).toBe('false');
    expect(parent.textContent).toContain('1 asset');
    fireEvent.click(parent);
    expect(parent.getAttribute('aria-expanded')).toBe('true');
    const child = screen.getByRole('button', { name: 'Database (1)' });
    expect(child.textContent).toContain('1 asset');
    fireEvent.click(child);
    expect(screen.getByLabelText('Inspect Production database')).toBeTruthy();
    fireEvent.click(parent);
    expect(screen.queryByRole('button', { name: 'Database (1)' })).toBeNull();
  });

  it('counts descendants, keeps root assets visible, and hides the picker for flat sources', () => {
    render(
      <AssetReviewQueue
        assets={[
          { ...asset, id: 'root', name: 'Root asset', sourceFileName: 'prod.kdbx' },
          {
            ...asset,
            id: 'nested-1',
            name: 'Nested one',
            sourceFileName: 'prod.kdbx',
            folderPath: ['Team', 'Subfolder'],
          },
          {
            ...asset,
            id: 'nested-2',
            name: 'Nested two',
            sourceFileName: 'prod.kdbx',
            folderPath: ['Team'],
          },
          {
            ...asset,
            id: 'flat',
            name: 'Flat asset',
            source: 'flat.csv',
            sourceFileName: 'flat.csv',
          },
        ]}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Tree' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Filter by source'), { target: { value: 'prod.kdbx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tree' }));
    expect(screen.getByLabelText('Inspect Root asset')).toBeTruthy();
    const team = screen.getByRole('button', { name: 'Team (2)' });
    expect(team.textContent).toContain('2 assets');
    fireEvent.click(team);
    expect(screen.getByRole('button', { name: 'Subfolder (1)' }).textContent).toContain('1 asset');
    fireEvent.change(screen.getByLabelText('Filter by source'), { target: { value: 'flat.csv' } });
    expect(screen.queryByRole('button', { name: 'Tree' })).toBeNull();
    expect(screen.getByLabelText('Inspect Flat asset')).toBeTruthy();
  });

  it('lists files with no Assets and keeps a search when its icon closes the field', () => {
    render(
      <AssetReviewQueue
        assets={[{ ...asset, sourceId: 'source-prod', sourceFileName: 'prod.kdbx' }]}
        sourceFiles={[
          { id: 'empty-source', name: 'empty.csv' },
          { id: 'source-prod', name: 'prod.kdbx' },
        ]}
      />,
    );
    expect(screen.getByRole('option', { name: 'empty.csv' })).toBeTruthy();
    expect(screen.getAllByRole('option', { name: 'prod.kdbx' })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Filter by source'), {
      target: { value: 'empty-source' },
    });
    expect(screen.queryByLabelText('Inspect Production database')).toBeNull();
    fireEvent.change(screen.getByLabelText('Filter by source'), { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search assets' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search assets' }), {
      target: { value: 'missing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close asset search' }));
    expect(screen.queryByLabelText('Inspect Production database')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Search assets' }));
    expect((screen.getByRole('textbox', { name: 'Search assets' }) as HTMLInputElement).value).toBe(
      'missing',
    );
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
