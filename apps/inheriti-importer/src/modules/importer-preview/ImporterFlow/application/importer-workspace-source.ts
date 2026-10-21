import type { ImporterWorkspaceContext } from './use-importer-workspace';
import { clearWorkspaceLiterals, removeSourceFromWorkspace } from './importer-workspace-cleanup';

export function createSourceActions(context: ImporterWorkspaceContext) {
  const {
    session,
    projection,
    setDecisions,
    setMappingOverrides,
    setPlainTextOverrides,
    setPlainTextAssetIds,
    setStructuredSuggestions,
    updateWorkspace,
    replaceWorkspace,
  } = context;

  function clearSuggestionLiterals(nodeIds?: ReadonlySet<string>) {
    // Clear sensitive values before dropping their review state.
    for (const suggestion of projection.suggestions) {
      if (nodeIds && !nodeIds.has(suggestion.fromNodeId)) continue;
      for (const binding of Object.values(suggestion.fieldBindings)) {
        if (binding.kind === 'literal') binding.value.clear();
      }
    }
  }

  function resetReview() {
    clearSuggestionLiterals();
    setDecisions({});
    setMappingOverrides({});
    setPlainTextOverrides((current) => {
      Object.values(current).forEach((value) => value.clear());
      return {};
    });
    setPlainTextAssetIds(new Set());
    setStructuredSuggestions({});
  }

  function removeSource(sourceId: string) {
    const nodeIds = new Set(
      Object.values(session.nodesById)
        .filter((node) => node.sourceId === sourceId)
        .map((node) => node.id),
    );
    const belongsToSource = (key: string) => nodeIds.has(key.slice(0, key.lastIndexOf(':')));
    clearSuggestionLiterals(nodeIds);
    setDecisions((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !belongsToSource(key))),
    );
    setMappingOverrides((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !belongsToSource(key))),
    );
    setPlainTextOverrides((current) => {
      Object.entries(current).forEach(([key, value]) => {
        if (belongsToSource(key)) value.clear();
      });
      return Object.fromEntries(Object.entries(current).filter(([key]) => !belongsToSource(key)));
    });
    setPlainTextAssetIds((current) => new Set([...current].filter((key) => !belongsToSource(key))));
    setStructuredSuggestions((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !belongsToSource(key))),
    );
    const remove = (current: Parameters<typeof removeSourceFromWorkspace>[1]) =>
      removeSourceFromWorkspace(session, current, sourceId);
    const clear = (discarded: Parameters<typeof clearWorkspaceLiterals>[0]) =>
      clearWorkspaceLiterals(discarded, nodeIds);
    if (replaceWorkspace) replaceWorkspace(remove, clear);
    else updateWorkspace(remove);
  }

  return { resetReview, removeSource };
}
