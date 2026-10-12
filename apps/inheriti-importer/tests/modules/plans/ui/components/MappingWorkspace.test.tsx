// @vitest-environment happy-dom
// The local Asset editor loads Core's `/core` bundle, whose text-encoding path
// breaks under jsdom's globals. See the SafeKey test stub and Vite test alias.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MappingWorkspace } from '@modules/plans/ui/components/MappingWorkspace';
import type { ImportSession } from '@modules/import/domain/import-model';
import type { StoredEntry } from '@modules/import/infrastructure/stores/vault-store';
import { importSessionFromVaultState } from '@modules/import/infrastructure/stores/vault-session-adapter';
import {
  createEmptyEntry,
  type ImportedVault,
  type VaultEntry,
} from '@modules/import/domain/vault';
import { makePlanDraft, type PlanDraft } from '@modules/plans/domain/workspace-model';

afterEach(cleanup);

function entry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return createEmptyEntry({
    id: 'e1',
    sourceId: 'v1',
    title: 'GitHub',
    username: 'octo',
    password: 'sup3r-secret',
    url: 'github.com',
    ...overrides,
  });
}

function stored(current: VaultEntry): StoredEntry {
  return { current, original: current };
}

const vault: ImportedVault = {
  id: 'v1',
  name: 'Personal.kdbx',
  kind: 'keepass',
  fileName: 'personal.kdbx',
  importedAt: new Date().toISOString(),
};

/** Builds the matching `ImportSession` from the same entries via the real
 *  production adapter, since `MappingWorkspace`'s suggestion engine reads
 *  `session.nodesById`/`fieldsById` — a *separate* model from `StoredEntry`
 *  that App.tsx keeps in sync via this exact adapter. */
function sessionFor(entries: StoredEntry[]): ImportSession {
  return importSessionFromVaultState({
    vaults: [vault],
    entries,
    selectedVaultId: 'all',
    selectedEntryId: null,
    query: '',
    warnings: [],
  });
}

function baseProps(overrides: Partial<Parameters<typeof MappingWorkspace>[0]> = {}) {
  const entries = (overrides.entries as StoredEntry[] | undefined) ?? [];
  return {
    entries,
    vaults: [vault] as ImportedVault[],
    plans: [] as PlanDraft[],
    selectedPlanClientId: null,
    mappedSourceFieldIds: new Set<string>(),
    ignoredSourceFieldIds: new Set<string>(),
    busy: false,
    onImport: vi.fn(),
    onSelectPlan: vi.fn(),
    onCreatePlan: vi.fn(),
    onEditPlan: vi.fn(),
    onDeletePlan: vi.fn(),
    onEditAsset: vi.fn(),
    onDeleteAsset: vi.fn(),
    onMoveAsset: vi.fn(),
    onToggleIgnore: vi.fn(),
    session: sessionFor(entries) as ImportSession,
    onSave: vi.fn(),
    onApplySuggestion: vi.fn(),
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    ...overrides,
  };
}

describe('MappingWorkspace', () => {
  it('renders the empty state with no vaults or Plans', () => {
    render(<MappingWorkspace {...baseProps({ vaults: [] })} />);
    expect(screen.getByText(/Drop an entry here/i)).toBeTruthy();
    expect(screen.getByText('0 fields · 0 Plans · 0 Assets')).toBeTruthy();
  });

  it('reveals and hides a masked sensitive field value, by click and by keyboard', () => {
    render(<MappingWorkspace {...baseProps({ entries: [stored(entry())] })} />);
    fireEvent.click(screen.getByRole('button', { name: /Expand GitHub/i }));
    expect(screen.getByText('••••••••')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reveal value' }));
    expect(screen.getByText('sup3r-secret')).toBeTruthy();

    const hideButton = screen.getByRole('button', { name: 'Hide value' });
    fireEvent.keyDown(hideButton, { key: 'Enter' });
    expect(screen.getByText('••••••••')).toBeTruthy();
  });

  it('toggles a field ignored via the Toggle switch, by click and by keyboard', () => {
    const onToggleIgnore = vi.fn();
    render(<MappingWorkspace {...baseProps({ entries: [stored(entry())], onToggleIgnore })} />);
    fireEvent.click(screen.getByRole('button', { name: /Expand GitHub/i }));

    const usernameToggle = screen.getAllByRole('switch', { name: 'Ignore field' })[0]!;
    fireEvent.click(usernameToggle);
    expect(onToggleIgnore).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(usernameToggle, { key: ' ' });
    expect(onToggleIgnore).toHaveBeenCalledTimes(2);
  });

  it('opens Suggested Assets when the per-entry "Map to Plan" action is used with the mouse', () => {
    render(
      <MappingWorkspace
        {...baseProps({ entries: [stored(entry())], selectedPlanClientId: 'plan-1' })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Map GitHub to Plan' }));
    expect(screen.getByText('Suggested Assets')).toBeTruthy();
  });

  it('opens Suggested Assets from the same action via the keyboard (Enter)', () => {
    render(
      <MappingWorkspace
        {...baseProps({ entries: [stored(entry())], selectedPlanClientId: 'plan-1' })}
      />,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Map GitHub to Plan' }), { key: 'Enter' });
    expect(screen.getByText('Suggested Assets')).toBeTruthy();
  });

  it('creates a Plan first when mapping with no Plan selected yet (background-drop equivalent)', () => {
    const onCreatePlan = vi.fn();
    render(
      <MappingWorkspace
        {...baseProps({ entries: [stored(entry())], selectedPlanClientId: null, onCreatePlan })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Map GitHub to Plan' }));
    expect(onCreatePlan).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Suggested Assets')).toBeTruthy();
  });

  it('hides the per-entry "Map to Plan" action once every field is mapped', () => {
    const single = entry({ username: '', password: '', url: '', notes: '' });
    render(
      <MappingWorkspace
        {...baseProps({
          entries: [stored(single)],
          mappedSourceFieldIds: new Set(['e1:username', 'e1:password', 'e1:url', 'e1:notes']),
        })}
      />,
    );
    expect(screen.queryByRole('button', { name: /Map .* to Plan/ })).toBeNull();
  });

  it('offers a group-level "Map all" action and includes every unmapped entry in the group', () => {
    const first = entry({ id: 'e1', title: 'First', group: 'Work' });
    const second = entry({ id: 'e2', title: 'Second', group: 'Work' });
    render(
      <MappingWorkspace
        {...baseProps({ entries: [stored(first), stored(second)], selectedPlanClientId: 'plan-1' })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Map all of Work to Plan' }));
    expect(screen.getByText('Suggested Assets')).toBeTruthy();
    // Both entries produced a reviewable suggestion (one per entry) — group-level suggestion.
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('lets the user deselect a suggestion by mouse and by keyboard before applying', () => {
    const onApplySuggestion = vi.fn();
    render(
      <MappingWorkspace
        {...baseProps({
          entries: [stored(entry())],
          selectedPlanClientId: 'plan-1',
          onApplySuggestion,
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Map GitHub to Plan' }));

    const radio = screen.getByRole('radio');
    fireEvent.click(radio); // deselect the only, pre-selected suggestion
    fireEvent.click(screen.getByRole('button', { name: 'Apply suggestion' }));
    expect(onApplySuggestion).not.toHaveBeenCalled();
  });

  it('applies a selected suggestion and removes it from the review list', () => {
    const onApplySuggestion = vi.fn();
    render(
      <MappingWorkspace
        {...baseProps({
          entries: [stored(entry())],
          selectedPlanClientId: 'plan-1',
          onApplySuggestion,
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Map GitHub to Plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply suggestion' }));
    expect(onApplySuggestion).toHaveBeenCalledTimes(1);
    expect(onApplySuggestion.mock.calls[0]![0]).toMatchObject({
      type: 'USER-PSWD',
      name: 'GitHub',
    });
  });

  it('collapses a source group, hiding its entries, by mouse and by keyboard', () => {
    render(<MappingWorkspace {...baseProps({ entries: [stored(entry({ group: 'Work' }))] })} />);
    expect(screen.getByText('GitHub')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Work' }));
    expect(screen.queryByText('GitHub')).toBeNull();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Expand Work' }), { key: 'Enter' });
    expect(screen.getByText('GitHub')).toBeTruthy();
  });

  it('shows a dense list of many entries within one vault without losing per-entry actions', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      stored(entry({ id: `e${i}`, title: `Entry ${i}` })),
    );
    render(<MappingWorkspace {...baseProps({ entries: many, vaults: [vault] })} />);
    expect(screen.getAllByRole('button', { name: /^Map Entry \d+ to Plan$/ })).toHaveLength(12);
  });

  it('falls back to one selected PLAIN-TEXT schema field when no typed Asset match is found', () => {
    render(
      <MappingWorkspace
        {...baseProps({
          entries: [
            stored(
              entry({ username: '', password: '', notes: 'a stray note', title: 'Weird', url: '' }),
            ),
          ],
          selectedPlanClientId: 'plan-1',
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Map Weird to Plan' }));
    expect(screen.getByText('Plain Text')).toBeTruthy();
    // The selected source field is masked like any other secret value until revealed.
    expect(screen.getByText('••••••••')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal value' }));
    expect(screen.getByText(/a stray note/)).toBeTruthy();
  });

  it('disables Save while there are no Plans/Assets yet and enables it once both exist', () => {
    const { rerender } = render(<MappingWorkspace {...baseProps()} />);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);

    const plan = {
      ...makePlanDraft('plan-1', 'My Plan'),
      assets: [{ id: 'a1', type: 'PLAIN-TEXT', name: 'Note', fieldBindings: {} }],
    };
    rerender(<MappingWorkspace {...baseProps({ plans: [plan] })} />);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false);
  });

  it('surfaces Undo/Redo affordances driven by the host-owned history state', () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(<MappingWorkspace {...baseProps({ canUndo: true, canRedo: false, onUndo, onRedo })} />);
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Redo' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('shows a loading state on Import while an import is in flight', () => {
    render(<MappingWorkspace {...baseProps({ busy: true })} />);
    expect(screen.getByRole('button', { name: 'Opening…' })).toHaveProperty('disabled', true);
  });

  it('marks a fully-mapped entry read-only for drag (native DnD is disabled once every field is bound)', () => {
    const single = entry({ username: '', password: '', url: '', notes: '' });
    render(
      <MappingWorkspace
        {...baseProps({
          entries: [stored(single)],
          mappedSourceFieldIds: new Set(['e1:username', 'e1:password', 'e1:url', 'e1:notes']),
        })}
      />,
    );
    const row = screen.getByText('GitHub').closest('.tree-row');
    expect(row?.hasAttribute('draggable')).toBe(false);
  });

  it('renders within the two-panel layout section', () => {
    const { container } = render(<MappingWorkspace {...baseProps()} />);
    expect(within(container).getByText('Imported Data')).toBeTruthy();
    expect(within(container).getByText('Plans')).toBeTruthy();
  });
});
