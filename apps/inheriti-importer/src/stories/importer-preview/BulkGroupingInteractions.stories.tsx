import { useState } from 'react';
import {
  PlanGroupingSurface,
  type GroupingAsset,
  type PlanDraft,
} from '@modules/importer-preview/PlanGroupingSurface';
import { ShellFixture } from './shell-fixtures';

const initialAssets: GroupingAsset[] = [
  {
    id: 'database',
    name: 'Production database',
    type: 'USER-PSWD',
    source: 'infrastructure.kdbx',
    sourceId: 'kdbx-1',
    folderPath: ['Operations', 'Databases'],
    valid: true,
  },
  {
    id: 'staging',
    name: 'Staging server',
    type: 'USER-PSWD',
    source: 'infrastructure.kdbx',
    sourceId: 'kdbx-1',
    folderPath: ['Operations', 'Servers'],
    valid: true,
  },
  {
    id: 'backup',
    name: 'Backup server',
    type: 'USER-PSWD',
    source: 'infrastructure.kdbx',
    sourceId: 'kdbx-1',
    folderPath: ['Operations', 'Servers'],
    valid: true,
  },
  {
    id: 'cloud',
    name: 'Cloud operator',
    type: 'USER-PSWD',
    source: 'cloud.1pux',
    sourceId: 'cloud-1',
    folderPath: ['Operations'],
    valid: true,
  },
];
const initialPlans: PlanDraft[] = [
  {
    id: 'servers',
    name: 'Servers',
    assets: 0,
    capacity: '0 / 3 Assets',
    valid: true,
    assignedAssets: [],
    sourceGroup: { sourceId: 'kdbx-1', path: ['Operations', 'Servers'] },
    sourceName: 'infrastructure.kdbx',
  },
  {
    id: 'cloud-plan',
    name: 'Cloud',
    assets: 0,
    capacity: '0 / 10 Assets',
    valid: true,
    assignedAssets: [],
    sourceGroup: { sourceId: 'cloud-1', path: ['Operations'] },
    sourceName: 'cloud.1pux',
  },
];

export const BulkGroupingInteractions = () => {
  const [unassigned, setUnassigned] = useState(initialAssets);
  const [plans, setPlans] = useState(initialPlans);
  const [selectedPlanId, setSelectedPlanId] = useState('servers');
  const assign = (assets: GroupingAsset[], target: PlanDraft) => {
    setUnassigned((current) =>
      current.filter((asset) => !assets.some((moved) => moved.id === asset.id)),
    );
    setPlans((current) =>
      current.map((plan) => {
        const existing = (plan.assignedAssets ?? []).filter(
          (asset) => !assets.some((moved) => moved.id === asset.id),
        );
        const assignedAssets = plan.id === target.id ? [...existing, ...assets] : existing;
        return { ...plan, assignedAssets, assets: assignedAssets.length };
      }),
    );
  };
  const unassign = (assets: GroupingAsset[]) => {
    setUnassigned((current) => [...current, ...assets]);
    setPlans((current) =>
      current.map((plan) => {
        const assignedAssets = (plan.assignedAssets ?? []).filter(
          (asset) => !assets.some((removed) => removed.id === asset.id),
        );
        return { ...plan, assignedAssets, assets: assignedAssets.length };
      }),
    );
  };
  return (
    <ShellFixture>
      <PlanGroupingSurface
        unassigned={unassigned}
        plans={plans}
        selectedPlanId={selectedPlanId}
        onSelectPlan={(plan) => setSelectedPlanId(plan.id)}
        onAssignMany={assign}
        onUnassignMany={unassign}
        onAssign={(asset, plan) => assign([asset], plan)}
        onUnassign={(asset) => unassign([asset])}
        onAutoGroup={(preserveStructure) => {
          const groups = new Map<string, GroupingAsset[]>();
          for (const asset of unassigned) {
            const path = preserveStructure ? (asset.folderPath ?? []) : [];
            const key = JSON.stringify([asset.sourceId ?? asset.source, path]);
            groups.set(key, [...(groups.get(key) ?? []), asset]);
          }
          const drafts = [...groups.entries()].map(([key, assets], index): PlanDraft => {
            const [sourceId, path] = JSON.parse(key) as [string, string[]];
            return {
              id: `group-${index}`,
              name: path.at(-1) ?? assets[0].source ?? 'Imported assets',
              sourceName: assets[0].source,
              sourceGroup: { sourceId, path },
              assets: assets.length,
              capacity: `${assets.length} / 10 Assets`,
              valid: true,
              assignedAssets: assets,
            };
          });
          setPlans((current) => [...current, ...drafts]);
          setUnassigned([]);
          if (drafts[0]) setSelectedPlanId(drafts[0].id);
        }}
      />
    </ShellFixture>
  );
};
