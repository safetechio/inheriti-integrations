import type { WorkspaceState } from '@modules/plans/domain/workspace-model';
import type { PlanFolder, PlanFolderScope } from '@modules/organization/domain/plan-folder';

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

type FolderCatalog = { scope: PlanFolderScope; folders: readonly Pick<PlanFolder, 'id'>[] };

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

export function filterHistoryByFolderCatalog(
  history: WorkspaceHistory,
  catalog: FolderCatalog | null,
): WorkspaceHistory {
  if (!catalog) return history;

  const folderIds = new Set(catalog.folders.map(({ id }) => id));
  const sharingModel = catalog.scope === 'PERSONAL' ? 'PRIVATE' : 'SHARED';
  const canRestore = (snapshot: WorkspaceState) =>
    Object.values(snapshot.plansByClientId).every(
      (plan) =>
        plan.governance.sharingModel !== sharingModel ||
        plan.folderId == null ||
        folderIds.has(plan.folderId),
    );
  const past = history.past.filter(canRestore);
  const future = history.future.filter(canRestore);
  if (past.length === history.past.length && future.length === history.future.length) return history;
  return { ...history, past, future };
}

export function getFolderHistoryControls(
  history: WorkspaceHistory,
  catalog: (FolderCatalog & {
    hasLoaded: boolean;
    loading?: boolean;
    refreshing?: boolean;
    error?: string;
  }) | null,
) {
  const verifiedCatalog =
    catalog?.hasLoaded && !catalog.loading && !catalog.refreshing && !catalog.error ? catalog : null;
  const available = verifiedCatalog && filterHistoryByFolderCatalog(history, verifiedCatalog);

  return {
    canUndo: available !== null && canUndo(available),
    canRedo: available !== null && canRedo(available),
    undo: (current: WorkspaceHistory) =>
      verifiedCatalog ? undo(filterHistoryByFolderCatalog(current, verifiedCatalog)) : current,
    redo: (current: WorkspaceHistory) =>
      verifiedCatalog ? redo(filterHistoryByFolderCatalog(current, verifiedCatalog)) : current,
  };
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
