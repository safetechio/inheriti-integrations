import { describe, expect, it } from 'vitest';
import {
  canRedo,
  canUndo,
  createHistory,
  filterHistoryByFolderCatalog,
  getFolderHistoryControls,
  pushHistory,
  replaceHistory,
  redo,
  undo,
} from '@modules/plans/domain/workspace-history';
import { createEmptyWorkspace, makePlanDraft } from '@modules/plans/domain/workspace-model';

describe('workspace history', () => {
  it('keeps bounded snapshots and restores present/future state', () => {
    const initial = createEmptyWorkspace();
    const first = {
      ...initial,
      planOrder: ['p1'],
      plansByClientId: { p1: makePlanDraft('p1', 'First') },
    };
    const second = {
      ...first,
      planOrder: ['p1', 'p2'],
      plansByClientId: { ...first.plansByClientId, p2: makePlanDraft('p2', 'Second') },
    };
    let history = pushHistory(createHistory(initial), first);
    history = pushHistory(history, second, 1);

    expect(canUndo(history)).toBe(true);
    expect(undo(history).present).toBe(first);
    expect(canRedo(undo(history))).toBe(true);
    expect(redo(undo(history)).present).toBe(second);
    expect(history.past).toHaveLength(1);
  });

  it('discards every snapshot through an explicit replacement', () => {
    const initial = createEmptyWorkspace();
    const first = { ...initial, revision: 1 };
    const second = { ...initial, revision: 2 };
    const discarded: number[] = [];
    const argumentCounts: number[] = [];
    const history = pushHistory(pushHistory(createHistory(initial), first), second);

    const replaced = replaceHistory(history, initial, function discard(workspace) {
      discarded.push(workspace.revision);
      argumentCounts.push(arguments.length);
    });

    expect(discarded).toEqual([0, 1, 2]);
    expect(argumentCounts).toEqual([1, 1, 1]);
    expect(replaced).toEqual(createHistory(initial));
  });

  it('skips an undo snapshot that would move a plan into a deleted folder', () => {
    const initial = createEmptyWorkspace();
    const inFolder = {
      ...initial,
      planOrder: ['p1'],
      plansByClientId: { p1: makePlanDraft('p1', 'First', 'deleted') },
    };
    const atRoot = {
      ...inFolder,
      plansByClientId: { p1: makePlanDraft('p1', 'First', null) },
    };
    const history = pushHistory(pushHistory(createHistory(initial), inFolder), atRoot);
    const catalog = { scope: 'SHARED' as const, folders: [] };
    const filtered = filterHistoryByFolderCatalog(history, catalog);
    const onlyStaleUndo = pushHistory(createHistory(inFolder), atRoot);

    expect(canUndo(filterHistoryByFolderCatalog(onlyStaleUndo, catalog))).toBe(false);

    expect(filtered.present).toBe(atRoot);
    expect(canUndo(filtered)).toBe(true);
    expect(undo(filtered).present).toBe(initial);
    expect(redo(undo(filtered)).present).toBe(atRoot);
  });

  it('drops redo that recreates a plan in a deleted folder and keeps other scopes', () => {
    const initial = createEmptyWorkspace();
    const inFolder = {
      ...initial,
      planOrder: ['p1'],
      plansByClientId: { p1: makePlanDraft('p1', 'First', 'deleted') },
    };
    const history = undo(pushHistory(createHistory(initial), inFolder));

    expect(filterHistoryByFolderCatalog(history, null)).toBe(history);
    expect(
      filterHistoryByFolderCatalog(history, { scope: 'SHARED', folders: [{ id: 'deleted' }] }),
    ).toBe(history);
    expect(canRedo(filterHistoryByFolderCatalog(history, { scope: 'SHARED', folders: [] }))).toBe(
      false,
    );

    const privateFolder = {
      ...inFolder,
      plansByClientId: { p1: makePlanDraft('p1', 'First', 'private-folder', 'PERSONAL') },
    };
    const bothPlans = pushHistory(pushHistory(createHistory(initial), inFolder), privateFolder);
    const mixedHistory = undo(undo(bothPlans));
    const filtered = filterHistoryByFolderCatalog(mixedHistory, { scope: 'SHARED', folders: [] });

    expect(filtered.future).toEqual([privateFolder]);
    expect(redo(filtered).present).toBe(privateFolder);
  });

  it('pauses both history controls until the folder catalog is verified', () => {
    const atRoot = createEmptyWorkspace();
    const earlier = { ...atRoot, revision: 1 };
    const later = { ...atRoot, revision: 5 };
    const inFolder = {
      ...atRoot,
      planOrder: ['p1'],
      plansByClientId: { p1: makePlanDraft('p1', 'First', 'deleted') },
    };
    const history = { past: [earlier, inFolder], present: atRoot, future: [inFolder, later] };
    const catalog = { scope: 'SHARED' as const, hasLoaded: true, folders: [{ id: 'deleted' }] };

    for (const unavailable of [
      null,
      { ...catalog, hasLoaded: false, folders: [] },
      { ...catalog, loading: true },
      { ...catalog, refreshing: true },
      { ...catalog, error: 'Could not load folders.' },
    ]) {
      const controls = getFolderHistoryControls(history, unavailable);
      expect(controls.canUndo).toBe(false);
      expect(controls.canRedo).toBe(false);
      expect(controls.undo(history)).toBe(history);
      expect(controls.redo(history)).toBe(history);
    }

    const recovered = getFolderHistoryControls(history, catalog);
    expect(recovered.canUndo).toBe(true);
    expect(recovered.canRedo).toBe(true);
    expect(recovered.undo(history).present).toBe(inFolder);
    expect(recovered.redo(history).present).toBe(inFolder);

    const deleted = getFolderHistoryControls(history, { ...catalog, folders: [] });
    expect(deleted.canUndo).toBe(true);
    expect(deleted.canRedo).toBe(true);
    expect(deleted.undo(history).present).toBe(earlier);
    expect(deleted.redo(history).present).toBe(later);
  });
});
