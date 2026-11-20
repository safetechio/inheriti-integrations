import type { ImportSession } from '@modules/import/domain/import-model';
import { suggestedAssetToDraft } from '@modules/mapping/application/suggestion-engine';
import {
  sourceSuggestions,
  statusKey,
} from '@modules/importer-preview/ImporterFlow/application/importer-workspace-suggestions';
import {
  createEmptyWorkspace,
  makePlanDraft,
  type WorkspaceState,
} from '@modules/plans/domain/workspace-model';
import { createHistory, pushHistory } from '@modules/plans/domain/workspace-history';

export type GroupingScenario =
  'ready' | 'grouped' | 'manual' | 'capacity' | 'history' | 'empty' | 'large';

export function storyWorkspace(session: ImportSession, scenario: GroupingScenario) {
  const empty = createEmptyWorkspace();
  if (scenario === 'empty' || scenario === 'ready' || scenario === 'large')
    return createHistory(empty);
  const suggestions = sourceSuggestions(session).filter((item) => item.type === 'USER-PSWD');
  const assets = suggestions
    .filter((item) => item.fromNodeId.startsWith('folder-story-'))
    .map((item) => suggestedAssetToDraft(item, statusKey(item)));
  const first = makePlanDraft(
    'story-first',
    scenario === 'manual' ? 'My edited operations plan' : 'Database',
  );
  first.sourceGroup = { sourceId: 'synthetic-vault', path: ['Infrastructure', 'Database'] };
  first.assets = scenario === 'capacity' ? assets.slice(0, 10) : assets.slice(0, 1);
  if (scenario === 'manual')
    first.description = 'Keep this manual description and the assigned asset';
  const plansByClientId: WorkspaceState['plansByClientId'] = { [first.clientId]: first };
  const planOrder = [first.clientId];
  if (scenario === 'grouped' || scenario === 'capacity') {
    const second = makePlanDraft('story-second', 'Database');
    second.sourceGroup = {
      sourceId: 'synthetic-second-vault',
      path: ['Infrastructure', 'Database'],
    };
    second.assets = assets.filter((asset) => asset.id.startsWith('folder-story-11')).slice(0, 1);
    plansByClientId[second.clientId] = second;
    planOrder.push(second.clientId);
  }
  const populated = { ...empty, plansByClientId, planOrder, revision: 1 };
  return scenario === 'history'
    ? pushHistory(createHistory(empty), populated)
    : createHistory(populated);
}
