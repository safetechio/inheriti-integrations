import { useEffect, useRef, useState } from 'react';
import { Box, Text } from '@main-components';
import { PlanGroupingSurface } from '@modules/importer-preview/PlanGroupingSurface';
import type {
  Folder,
  GroupingAsset,
  PlanDraft,
} from '@modules/importer-preview/PlanGroupingSurface';
import { ImporterFlow } from '@modules/importer-preview/ImporterFlow';
import { useImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/importer-workspace';
import { AppHeader } from '@modules/import/ui/components/AppHeader';
import type { WorkspaceState } from '@modules/plans/domain/workspace-model';
import { pushHistory, resetHistory, undo, redo } from '@modules/plans/domain/workspace-history';
import { ShellFixture } from './shell-fixtures';
import { createFolderGroupingFixture } from './folder-grouping/fixture';
import { storyWorkspace, type GroupingScenario } from './folder-grouping/workspace';
import { folderAdapter } from './folder-grouping/folder-adapter';

const storyPolicy = { teams: { allow: ['story-team'], deny: [] } };

function FolderGroupingStory({
  scenario,
  fullFlow = false,
}: {
  scenario: GroupingScenario;
  fullFlow?: boolean;
}) {
  const [{ session, files }] = useState(() => createFolderGroupingFixture(scenario === 'large'));
  const [history, setHistory] = useState(() => storyWorkspace(session, scenario));
  const [selectedPlanId, setSelectedPlanId] = useState<string>();
  const [storyFolders, setStoryFolders] = useState<Folder[]>([
    {
      id: 'engineering',
      name: 'Engineering',
      policy: storyPolicy,
      parentId: null,
      scope: 'SHARED',
      revision: 1,
      effectivePolicy: storyPolicy,
    },
    {
      id: 'infrastructure',
      name: 'Infrastructure',
      parentId: 'engineering',
      scope: 'SHARED',
      revision: 1,
      effectivePolicy: storyPolicy,
    },
    {
      id: 'finance',
      name: 'Finance',
      policy: storyPolicy,
      parentId: null,
      scope: 'SHARED',
      revision: 1,
      effectivePolicy: storyPolicy,
    },
  ]);
  const setWorkspace = (next: WorkspaceState | ((current: WorkspaceState) => WorkspaceState)) =>
    setHistory((current) =>
      pushHistory(current, typeof next === 'function' ? next(current.present) : next),
    );
  const workspace = useImporterWorkspace(session, history.present, setWorkspace, undefined, () =>
    setHistory(resetHistory),
  );
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || scenario === 'empty' || scenario === 'history') return;
    initialized.current = true;
    workspace.acceptAllEligible();
  }, [scenario, workspace]);
  if (fullFlow && !initialized.current) return null;
  if (fullFlow)
    return (
      <ShellFixture>
        <ImporterFlow
          folders={{
            folders: storyFolders,
            teams: [{ id: 'story-team', name: 'Operations' }],
            scope: 'SHARED',
            ...folderAdapter(storyFolders, setStoryFolders, workspace.plans),
          }}
          headerActions={<AppHeader dirtyCount={0} />}
          initialStage="plans"
          autoAdvance={false}
          files={files}
          assets={workspace.assets}
          unassigned={workspace.unassigned}
          plans={workspace.plans}
          checklist={[]}
          stagingState="waiting-release"
          stagingReady={false}
          callbacks={{
            onReviewAsset: (action, asset) => {
              if (action === 'accept' || action === 'exclude' || action === 'restore-suggestion')
                workspace.reviewAsset(action, asset);
            },
            onAcceptAllEligible: workspace.acceptAllEligible,
            onUndoAcceptAll: workspace.undoAcceptAll,
            resolveSourceValue: workspace.resolveSourceValue,
            onMapField: workspace.mapAssetField,
            onEditPlainText: workspace.editPlainText,
            onAssignAsset: workspace.assignAsset,
            onAssignAssets: workspace.assignAssets,
            onUnassignAsset: workspace.unassignAsset,
            onUnassignAssets: workspace.unassignAssets,
            onAutoGroupUnassigned: workspace.autoGroupUnassigned,
            onCreatePlan: workspace.createPlan,
            onCreatePlansFromAssets: workspace.createPlansFromAssets,
            onEnsureFirstPlan: workspace.ensureFirstPlan,
            onDeletePlan: workspace.deletePlan,
            onDeletePlans: workspace.deletePlans,
            onUpdatePlan: workspace.updatePlanMetadata,
            onMovePlans: workspace.movePlansToFolder,
            onUndoPlans: () => setHistory(undo),
            onRedoPlans: () => setHistory(redo),
            canUndoPlans: history.past.length > 0,
            canRedoPlans: history.future.length > 0,
          }}
        />
      </ShellFixture>
    );
  return (
    <ShellFixture>
      <Box gap="s">
        <Text variant="bodySmall">
          Synthetic sources only. Auto group can preserve source folders or group by source. Undo
          and Redo apply to whole workspace operations.
        </Text>
        <PlanGroupingSurface
          unassigned={workspace.unassigned}
          plans={workspace.plans}
          selectedPlanId={selectedPlanId}
          onSelectPlan={(plan) => setSelectedPlanId(plan.id)}
          onAssign={workspace.assignAsset}
          onAssignMany={workspace.assignAssets}
          onUnassign={workspace.unassignAsset}
          onUnassignMany={workspace.unassignAssets}
          onAutoGroup={workspace.autoGroupUnassigned}
          onCreatePlan={(options) => {
            const id = workspace.createPlan(options);
            setSelectedPlanId(id);
            return id;
          }}
          onDeletePlan={workspace.deletePlan}
          onDeletePlans={workspace.deletePlans}
          onUpdatePlan={workspace.updatePlanMetadata}
          onUndo={() => setHistory(undo)}
          onRedo={() => setHistory(redo)}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
        />
        <Text variant="bodySmall">
          Organization folders are unavailable in this local preview. Folder placement in Business
          requires an authenticated destination.
        </Text>
      </Box>
    </ShellFixture>
  );
}

export const ReadyToGroupNestedSources = () => <FolderGroupingStory scenario="ready" />;
export const AlreadyGroupedSameNameFolders = () => <FolderGroupingStory scenario="grouped" />;
export const ManualPlanPreserved = () => <FolderGroupingStory scenario="manual" />;
export const CapacityBlockedMove = () => <FolderGroupingStory scenario="capacity" />;
export const UndoRedoBatchHistory = () => <FolderGroupingStory scenario="history" />;
export const LargeSyntheticSet = () => <FolderGroupingStory scenario="large" />;
export const NoAcceptedAssets = () => <FolderGroupingStory scenario="empty" />;
export const FullFlowCreatePlans = () => <FolderGroupingStory scenario="ready" fullFlow />;
FullFlowCreatePlans.meta = { iframed: true };

function OrganisationFolderPreview({
  state = 'ready',
}: {
  state?: 'ready' | 'empty' | 'error' | 'loading';
}) {
  const [folders, setFolders] = useState<Folder[]>(
    state === 'empty'
      ? []
      : [
          {
            id: 'engineering',
            name: 'Engineering',
            policy: storyPolicy,
            parentId: null,
            scope: 'SHARED',
            revision: 1,
            effectivePolicy: storyPolicy,
          },
          {
            id: 'infrastructure',
            name: 'Infrastructure',
            parentId: 'engineering',
            scope: 'SHARED',
            revision: 1,
            effectivePolicy: storyPolicy,
          },
          {
            id: 'finance',
            name: 'Finance',
            policy: storyPolicy,
            parentId: null,
            scope: 'SHARED',
            revision: 1,
            effectivePolicy: storyPolicy,
          },
        ],
  );
  const scope = 'SHARED' as const;
  const [error, setError] = useState(
    state === 'error' ? 'Could not load organisation folders.' : '',
  );
  const [assets, setAssets] = useState<GroupingAsset[]>([
    {
      id: 'db',
      name: 'Database password',
      type: 'USER-PSWD',
      source: 'vault-kv-dump.json',
      folderPath: ['payments', 'prod'],
      valid: true,
    },
    {
      id: 'api',
      name: 'Payments API key',
      type: 'PLAIN-TEXT',
      source: 'vault-kv-dump.json',
      folderPath: ['payments', 'prod'],
      valid: true,
    },
    {
      id: 'kube',
      name: 'Kubernetes token',
      type: 'PLAIN-TEXT',
      source: 'k8s-secrets.yaml',
      folderPath: ['default'],
      valid: true,
    },
  ]);
  const [plans, setPlans] = useState<PlanDraft[]>([
    {
      id: 'vpn',
      name: 'Prod VPN',
      assets: 0,
      capacity: '0 / 50 Assets',
      valid: true,
      folderId: 'engineering',
      sharingModel: 'SHARED',
      assignedAssets: [],
    },
  ]);
  const create = (
    selected: GroupingAsset[],
    options: { name: string; folderId: string | null; scope: 'SHARED' | 'PERSONAL' },
  ) => {
    const id = crypto.randomUUID();
    setPlans((current) => [
      ...current,
      {
        id,
        name: options.name,
        folderId: options.folderId,
        sharingModel: options.scope === 'SHARED' ? 'SHARED' : 'PRIVATE',
        assignedAssets: selected,
        assets: selected.length,
        capacity: `${selected.length} / 50 Assets`,
        valid: true,
      },
    ]);
    setAssets((current) =>
      current.filter((asset) => !selected.some((item) => item.id === asset.id)),
    );
    return [id];
  };
  return (
    <ShellFixture>
      <PlanGroupingSurface
        unassigned={assets}
        plans={plans}
        folders={{
          folders,
          teams: [{ id: 'story-team', name: 'Operations' }],
          scope,
          loading: state === 'loading',
          error,
          onRetry: () => setError(''),
          ...folderAdapter(folders, setFolders, plans),
        }}
        onCreatePlan={(options) =>
          create([], {
            name: options?.name ?? 'New plan',
            folderId: options?.folderId ?? null,
            scope: options?.scope ?? scope,
          })[0]
        }
        onCreatePlansFromAssets={create}
        onAssignMany={(selected, plan) => {
          setPlans((current) =>
            current.map((item) =>
              item.id === plan.id
                ? {
                    ...item,
                    assignedAssets: [...(item.assignedAssets ?? []), ...selected],
                    assets: item.assets + selected.length,
                  }
                : item,
            ),
          );
          setAssets((current) =>
            current.filter((asset) => !selected.some((item) => item.id === asset.id)),
          );
        }}
        onUnassignMany={(selected) => {
          setAssets((current) => [...current, ...selected]);
          setPlans((current) =>
            current.map((plan) => ({
              ...plan,
              assignedAssets: plan.assignedAssets?.filter(
                (asset) => !selected.some((item) => item.id === asset.id),
              ),
              assets:
                plan.assets -
                selected.filter((item) =>
                  plan.assignedAssets?.some((asset) => asset.id === item.id),
                ).length,
            })),
          );
        }}
        onUpdatePlan={(plan, values) =>
          setPlans((current) =>
            current.map((item) =>
              item.id === plan.id
                ? {
                    ...item,
                    ...values,
                    sharingModel: values.scope
                      ? values.scope === 'SHARED'
                        ? 'SHARED'
                        : 'PRIVATE'
                      : item.sharingModel,
                  }
                : item,
            ),
          )
        }
        onMovePlans={(selected, folderId, targetScope) => {
          if (selected.some((plan) => (plan.sharingModel === 'PRIVATE' ? 'PERSONAL' : 'SHARED') !== targetScope)) return;
          setPlans((current) => current.map((plan) => selected.some((item) => item.id === plan.id) ? { ...plan, folderId } : plan));
        }}
        onDeletePlan={(plan) =>
          setPlans((current) => current.filter((item) => item.id !== plan.id))
        }
      />
    </ShellFixture>
  );
}

export const OrganisationFolderTree = () => <OrganisationFolderPreview />;
export const OrganisationFolderEmpty = () => <OrganisationFolderPreview state="empty" />;
export const OrganisationFolderError = () => <OrganisationFolderPreview state="error" />;

export const OrganisationFolderLoading = () => <OrganisationFolderPreview state="loading" />;
