import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AssetReviewQueue, type ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const asset = (id: string, overrides: Partial<ReviewAsset> = {}): ReviewAsset => ({
  id,
  name: id,
  type: 'USER-PSWD',
  status: 'suggested',
  rationale: 'Matched',
  mapped: ['Password'],
  unmapped: [],
  source: 'accounts.csv',
  sourceId: 'accounts',
  alternatives: [],
  ...overrides,
});
const stayed = { changedIds: [], skippedIds: [] };
const list = () => screen.getByRole('region', { name: 'Asset review list' });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const check = (name: string) => screen.getByRole<HTMLInputElement>('checkbox', { name });

it('keeps workspace batch undo available after leaving and remounting review', () => {
  const onUndoReviewBatch = vi.fn(() => ({ changedIds: ['Alpha'], skippedIds: [] }));
  const props = {
    assets: [asset('Alpha', { status: 'accepted' })],
    canUndoReviewBatch: true,
    onUndoReviewBatch,
  };
  const view = render(<AssetReviewQueue {...props} />);
  expect(screen.getByRole('button', { name: 'Undo last batch' })).toBeTruthy();
  view.unmount();
  render(<AssetReviewQueue {...props} />);
  click('Undo last batch');
  expect(onUndoReviewBatch).toHaveBeenCalledOnce();
});

it('clears selection with Escape in an editor without moving focus or reviewing typed shortcuts', () => {
  const onAction = vi.fn();
  render(
    <AssetReviewQueue
      assets={[asset('Alpha')]}
      onAction={onAction}
      onReviewAssets={() => stayed}
    />,
  );
  fireEvent.click(check('Select Alpha'));
  click('Search assets');
  const input = screen.getByRole('textbox', { name: 'Search assets' });
  input.focus();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(document.activeElement).toBe(input);
  expect(check('Select Alpha').checked).toBe(false);
  fireEvent.keyDown(input, { key: 'x' });
  expect(onAction).not.toHaveBeenCalled();
});

it('renders only the first 100 rows but selects every matching asset from the list', () => {
  const assets = Array.from({ length: 1_000 }, (_, index) => asset(`Account ${index}`));
  assets.push(asset('Different source', { source: 'other.csv', sourceId: 'other' }));
  const onReviewAssets = vi.fn(() => stayed);
  const { container } = render(
    <AssetReviewQueue assets={assets} onReviewAssets={onReviewAssets} />,
  );
  fireEvent.change(screen.getByLabelText('Filter by source'), { target: { value: 'accounts' } });
  expect(within(list()).getAllByRole('checkbox')).toHaveLength(100);
  expect(screen.queryByLabelText('Inspect Account 999')).toBeNull();
  fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
  expect(screen.queryByText('1000 selected')).toBeNull();
  fireEvent.keyDown(list(), { key: 'a', ctrlKey: true });
  expect(screen.getByText('1000 selected')).toBeTruthy();
  const card = container.querySelector('.asset-review-selection')!;
  expect(card.previousElementSibling).toBe(list());
  click('Accept selected');
  expect(onReviewAssets).toHaveBeenCalledWith('accept', assets.slice(0, 1000));
  click('Show more assets');
  expect(within(list()).getAllByRole('checkbox')).toHaveLength(100);
  expect(screen.getByLabelText('Inspect Account 100')).toBeTruthy();
  expect(screen.queryByLabelText('Inspect Account 0')).toBeNull();
  click('Previous assets');
  expect(screen.getByLabelText('Inspect Account 0')).toBeTruthy();
});

it('keeps inspection separate from checkboxes, command-click and shift range, and clears on Escape', () => {
  const assets = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((id) => asset(id));
  const onSelect = vi.fn();
  const onReviewAssets = vi.fn(() => stayed);
  render(<AssetReviewQueue assets={assets} onSelect={onSelect} onReviewAssets={onReviewAssets} />);

  click('Inspect Bravo');
  expect(onSelect).toHaveBeenLastCalledWith(assets[1]);
  expect(check('Select Bravo').checked).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Alpha' }), { metaKey: true });
  expect(check('Select Alpha').checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Charlie' }), { shiftKey: true });
  expect(check('Select Bravo').checked).toBe(true);
  expect(check('Select Charlie').checked).toBe(true);
  expect(check('Select Delta').checked).toBe(false);
  expect(onSelect).toHaveBeenCalledTimes(1);
  fireEvent.click(check('Select Bravo'));
  expect(check('Select Bravo').checked).toBe(false);
  fireEvent.keyDown(list(), { key: 'Escape' });
  expect(check('Select Alpha').checked).toBe(false);
  expect(screen.queryByText('2 selected')).toBeNull();
});

it.each(['Escape', 'Clear'])(
  'returns focus to the inspected row after %s clears selection',
  (action) => {
    const assets = ['Alpha', 'Bravo'].map((id) => asset(id));
    render(<AssetReviewQueue assets={assets} onReviewAssets={() => stayed} />);
    const alpha = screen.getByRole('button', { name: 'Inspect Alpha' });
    const bravo = screen.getByRole('button', { name: 'Inspect Bravo' });
    fireEvent.click(alpha);
    bravo.focus();
    fireEvent.click(bravo, { ctrlKey: true });
    expect(check('Select Bravo').checked).toBe(true);
    expect(document.activeElement).toBe(bravo);

    if (action === 'Escape') fireEvent.keyDown(bravo, { key: 'Escape' });
    else click('Clear');

    expect(check('Select Bravo').checked).toBe(false);
    expect(document.activeElement).toBe(alpha);
  },
);

it('filters exceptions with counts, clears selected assets on query and tab changes, and locates the next issue', () => {
  const invalid = asset('Missing', {
    schemaFields: [{ key: 'secret.password', label: 'Password', validationError: 'Required' }],
  });
  const omitted = asset('Omitted', { unmapped: ['token'] });
  const onSelect = vi.fn();
  render(
    <AssetReviewQueue
      assets={[asset('Ready'), invalid, omitted]}
      onSelect={onSelect}
      onReviewAssets={() => stayed}
    />,
  );

  fireEvent.keyDown(list(), { key: 'a', ctrlKey: true });
  expect(screen.getByText('3 selected')).toBeTruthy();
  click('Missing mappings 1');
  expect(screen.queryByText('3 selected')).toBeNull();
  expect(screen.queryByLabelText('Inspect Ready')).toBeNull();
  expect(screen.getByLabelText('Inspect Missing')).toBeTruthy();
  click('Missing mappings 1');
  click('Focus next issue');
  expect(onSelect).toHaveBeenLastCalledWith(invalid);
  click('Focus next issue');
  expect(onSelect).toHaveBeenLastCalledWith(omitted);
  click('Unmapped fields 1');
  expect(screen.queryByLabelText('Inspect Missing')).toBeNull();
  fireEvent.click(check('Select Omitted'));
  click('Search assets');
  const search = screen.getByRole('textbox', { name: 'Search assets' });
  fireEvent.change(search, { target: { value: 'no matches' } });
  expect(screen.queryByText('1 selected')).toBeNull();
  fireEvent.change(search, { target: { value: '' } });
  fireEvent.click(check('Select Omitted'));
  click('All 3');
  expect(check('Select Omitted').checked).toBe(false);
});

it('shows mixed subtree selection, scopes to filtered members, and uses expansion independently', () => {
  const onReviewAssets = vi.fn(() => stayed);
  const alpha = asset('Alpha', { folderPath: ['Team'] });
  const bravo = asset('Bravo', { folderPath: ['Team', 'Nested'] });
  const hidden = asset('Excluded', { folderPath: ['Team'], status: 'excluded' });
  const other = asset('Other', { source: 'other.csv', sourceId: 'other', folderPath: ['Team'] });
  render(
    <AssetReviewQueue assets={[alpha, bravo, hidden, other]} onReviewAssets={onReviewAssets} />,
  );
  click('Tree');
  const source = check('Select assets in accounts.csv');
  click('accounts.csv (2)');
  expect(source.checked).toBe(false);
  click('Team (2)');
  fireEvent.click(check('Select Alpha'));
  const team = check('Select assets in Team');
  expect(team.indeterminate).toBe(true);
  expect(source.indeterminate).toBe(true);
  fireEvent.click(team);
  expect(source.checked).toBe(true);
  expect(screen.queryByLabelText('Inspect Bravo')).toBeNull();
  click('Exclude selected');
  expect(onReviewAssets).toHaveBeenCalledWith('exclude', [alpha, bravo]);
});

it('uses batch shortcuts and retains Undo after a subsequent skipped action', () => {
  const alpha = asset('Alpha');
  const invalid = asset('Invalid', {
    schemaFields: [{ key: 'secret.password', label: 'Password', validationError: 'Required' }],
  });
  const onReviewAssets = vi
    .fn()
    .mockReturnValueOnce({ changedIds: ['Alpha'], skippedIds: ['Invalid'] })
    .mockReturnValueOnce({ changedIds: [], skippedIds: ['Invalid'] });
  const onUndo = vi.fn();
  render(
    <AssetReviewQueue
      assets={[alpha, invalid]}
      onReviewAssets={onReviewAssets}
      onUndoReviewBatch={onUndo}
      canUndoReviewBatch
    />,
  );
  fireEvent.keyDown(list(), { key: 'a', ctrlKey: true });
  click('Search assets');
  const input = screen.getByRole('textbox', { name: 'Search assets' });
  fireEvent.keyDown(input, { key: 'a' });
  fireEvent.keyDown(input, { key: 'a', metaKey: true });
  expect(onReviewAssets).not.toHaveBeenCalled();
  fireEvent.keyDown(list(), { key: 'a' });
  expect(onReviewAssets).toHaveBeenLastCalledWith('accept', [alpha, invalid]);
  expect(screen.getByText('1 accepted · 1 skipped')).toBeTruthy();
  fireEvent.click(check('Select Invalid'));
  fireEvent.keyDown(check('Select Invalid'), { key: 'x' });
  expect(onReviewAssets).toHaveBeenLastCalledWith('exclude', [invalid]);
  expect(screen.getByText('0 excluded · 1 skipped')).toBeTruthy();
  click('Undo');
  expect(onUndo).toHaveBeenCalledOnce();
});

it('opens tree rows on keyboard navigation and advances to the next pending asset after deciding', () => {
  const alpha = asset('Alpha', { folderPath: ['Team'] });
  const bravo = asset('Bravo', { folderPath: ['Support'] });
  const done = asset('Done', { status: 'accepted' });
  const action = vi.fn();
  const onSelect = vi.fn();
  const { rerender } = render(
    <AssetReviewQueue assets={[alpha, done, bravo]} onAction={action} onSelect={onSelect} />,
  );
  click('Tree');
  expect(screen.queryByLabelText('Inspect Bravo')).toBeNull();
  fireEvent.keyDown(list(), { key: 'ArrowDown' });
  expect(onSelect).toHaveBeenLastCalledWith(bravo);
  expect(screen.getByLabelText('Inspect Bravo')).toBeTruthy();
  click('Exclude');
  expect(action).toHaveBeenLastCalledWith('exclude', bravo);
  expect(onSelect).toHaveBeenLastCalledWith(alpha);
  rerender(
    <AssetReviewQueue
      assets={[alpha, done, bravo]}
      onAction={action}
      onSelect={onSelect}
      autoAdvance={false}
    />,
  );
  onSelect.mockClear();
  click('Accept');
  expect(action).toHaveBeenLastCalledWith('accept', alpha);
  expect(onSelect).not.toHaveBeenCalled();
});

it('marquee selects visible mounted rows without rendering a rectangle', () => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const { container } = render(
    <AssetReviewQueue assets={[asset('Alpha'), asset('Bravo')]} onReviewAssets={() => stayed} />,
  );
  const queue = list();
  const bounds = (top: number, bottom: number) => ({ left: 0, right: 100, top, bottom }) as DOMRect;
  vi.spyOn(queue, 'getBoundingClientRect').mockReturnValue(bounds(0, 100));
  const rows = container.querySelectorAll<HTMLElement>('[data-review-asset-id]');
  rows.forEach((row, index) => {
    vi.spyOn(row, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(
      bounds(10 + index * 110, 30 + index * 110),
    );
  });
  fireEvent.pointerDown(queue, { pointerType: 'mouse', button: 0, clientX: 5, clientY: 0 });
  fireEvent.pointerMove(document, { clientX: 95, clientY: 160 });
  expect(check('Select Alpha').checked).toBe(true);
  expect(check('Select Bravo').checked).toBe(false);
  expect(container.querySelector('[class*="marquee"]')).toBeNull();
  fireEvent.pointerUp(document);
});

it.each(['ctrlKey', 'metaKey'] as const)(
  'adds intersecting rows when dragging an inspection row with %s',
  (modifier) => {
    const assets = ['Alpha', 'Bravo', 'Charlie'].map((id) => asset(id));
    const onSelect = vi.fn();
    render(<AssetReviewQueue assets={assets} onSelect={onSelect} onReviewAssets={() => stayed} />);
    const queue = list();
    const bounds = (top: number, bottom: number) =>
      ({ left: 0, right: 100, top, bottom }) as DOMRect;
    vi.spyOn(queue, 'getBoundingClientRect').mockReturnValue(bounds(0, 100));
    queue.querySelectorAll('[data-review-asset-id]').forEach((row, index) => {
      vi.spyOn(row, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
      vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(
        bounds(10 + index * 30, 30 + index * 30),
      );
    });
    const alpha = screen.getByRole('button', { name: 'Inspect Alpha' });
    fireEvent.click(check('Select Charlie'));
    fireEvent.pointerDown(alpha, {
      pointerType: 'mouse',
      button: 0,
      [modifier]: true,
      clientX: 10,
      clientY: 20,
    });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 50 });
    fireEvent.pointerUp(document);
    fireEvent.click(alpha, { [modifier]: true });

    expect(check('Select Alpha').checked).toBe(true);
    expect(check('Select Bravo').checked).toBe(true);
    expect(check('Select Charlie').checked).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  },
);

it('preserves an independent two-pane scroll and reserves list space for the in-flow card', () => {
  const css = readFileSync(
    resolve(process.cwd(), 'src/modules/importer-preview/AssetReviewQueue/styles.css'),
    'utf8',
  );
  expect(css).toMatch(/\.asset-review-queue\s*\{[^}]*min-height:\s*120px/);
  expect(css).toMatch(
    /@media \(min-width:\s*760px\)[\s\S]*\.asset-review-queue,\s*\.asset-review-inspector\s*\{\s*overflow-y:\s*auto/,
  );
  expect(css).toMatch(/\.asset-review-selection\s*\{[^}]*flex:\s*0 0 auto/);
  expect(css).not.toMatch(/\.asset-review-selection\s*\{[^}]*position:/);
});

it('previews a compatible mapping count and requires confirmation before applying the inspected template', () => {
  const fields = (id: string, match: string) => [
    {
      key: 'secret.password',
      label: 'Password',
      sourceFieldId: `${id}-${match}`,
      candidates: [
        { id: `${id}-first`, name: 'Primary password' },
        { id: `${id}-second`, name: 'Backup password' },
      ],
    },
  ];
  const template = asset('Inspected template', { schemaFields: fields('template', 'second') });
  const target = asset('Compatible target', { schemaFields: fields('target', 'first') });
  const incompatible = asset('Incompatible target', { type: 'PLAIN-TEXT' });
  const onAcceptAllEligible = vi.fn(() => 2);
  const onApplyMappings = vi.fn(() => ({ changedIds: [target.id], skippedIds: [incompatible.id] }));
  render(
    <AssetReviewQueue
      assets={[template, target, incompatible]}
      onReviewAssets={() => stayed}
      onApplyMappings={onApplyMappings}
      onAcceptAllEligible={onAcceptAllEligible}
    />,
  );
  fireEvent.click(check('Select Compatible target'));
  fireEvent.click(check('Select Incompatible target'));
  click('Apply mappings');
  const confirmation = screen.getByRole('group', { name: 'Confirm applying mappings' });
  expect(confirmation.textContent).toContain('Inspected template · 1 compatible of 2 selected');
  expect(onApplyMappings).not.toHaveBeenCalled();
  fireEvent.keyDown(confirmation, { key: 'A', ctrlKey: true, shiftKey: true });
  expect(onAcceptAllEligible).not.toHaveBeenCalled();
  fireEvent.keyDown(confirmation, { key: 'Escape' });
  expect(confirmation.isConnected).toBe(false);
  expect(check('Select Compatible target').checked).toBe(true);
  click('Apply mappings');
  click('Confirm apply');
  expect(onApplyMappings).toHaveBeenCalledWith(template, [target, incompatible]);
  expect(screen.getByText('1 updated · 1 skipped')).toBeTruthy();
});

it('closes selection help on the first Escape and clears selection on the next', () => {
  const onReviewAssets = vi.fn(() => stayed);
  render(<AssetReviewQueue assets={[asset('Alpha')]} onReviewAssets={onReviewAssets} />);
  fireEvent.click(check('Select Alpha'));
  const help = screen.getByRole('button', { name: 'Asset review selection help' });
  fireEvent.click(help);
  const panel = screen.getByRole('region', { name: 'Asset review selection help' });
  expect(panel.parentElement).toBe(document.body);
  fireEvent.mouseDown(panel);
  fireEvent.keyDown(help, { key: 'A' });
  expect(panel.isConnected).toBe(true);
  expect(onReviewAssets).not.toHaveBeenCalled();
  fireEvent.mouseDown(document.body);
  expect(panel.isConnected).toBe(false);
  fireEvent.click(help);
  fireEvent.keyDown(help, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: 'Asset review selection help' })).toBeNull();
  expect(check('Select Alpha').checked).toBe(true);
  fireEvent.keyDown(help, { key: 'Escape' });
  expect(check('Select Alpha').checked).toBe(false);
});
