import { describe, expect, it } from 'vitest';
import {
  canRedo,
  canUndo,
  createHistory,
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
});
