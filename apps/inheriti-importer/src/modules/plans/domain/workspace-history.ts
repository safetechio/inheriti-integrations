import type { WorkspaceState } from '@modules/plans/domain/workspace-model';

/**
 * Bounded in-memory undo/redo. It keeps whole `WorkspaceState`
 * snapshots — safe because bindings hold *source field ids*, not secret values,
 * so a snapshot never duplicates a large secret. `SensitiveValue` instances in
 * `literal` bindings are shared by reference, not copied.
 */
export interface WorkspaceHistory {
  past: WorkspaceState[];
  present: WorkspaceState;
  future: WorkspaceState[];
}

const DEFAULT_LIMIT = 50;

export function createHistory(initial: WorkspaceState): WorkspaceHistory {
  return { past: [], present: initial, future: [] };
}

export function pushHistory(
  history: WorkspaceHistory,
  nextPresent: WorkspaceState,
  limit = DEFAULT_LIMIT,
): WorkspaceHistory {
  if (nextPresent === history.present) return history;
  const past = [...history.past, history.present].slice(-limit);
  return { past, present: nextPresent, future: [] };
}

export function canUndo(history: WorkspaceHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: WorkspaceHistory): boolean {
  return history.future.length > 0;
}

export function undo(history: WorkspaceHistory): WorkspaceHistory {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1]!;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo(history: WorkspaceHistory): WorkspaceHistory {
  if (history.future.length === 0) return history;
  const nextPresent = history.future[0]!;
  return {
    past: [...history.past, history.present],
    present: nextPresent,
    future: history.future.slice(1),
  };
}

/** Drop history without touching the present — used after cancel/completion. */
export function resetHistory(history: WorkspaceHistory): WorkspaceHistory {
  return { past: [], present: history.present, future: [] };
}

export function replaceHistory(
  history: WorkspaceHistory,
  present: WorkspaceState,
  discard?: (workspace: WorkspaceState) => void,
): WorkspaceHistory {
  if (discard) {
    for (const workspace of [...history.past, history.present, ...history.future]) {
      discard(workspace);
    }
  }
  return createHistory(present);
}
