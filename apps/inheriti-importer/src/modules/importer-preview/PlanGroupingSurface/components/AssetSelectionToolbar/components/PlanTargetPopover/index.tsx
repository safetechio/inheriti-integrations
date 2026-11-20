import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, Text } from '@main-components';
import { planCapacity, planUsage } from '../../../../capacity';
import type { GroupingAsset, PlanDraft } from '../../../../types';
import { PlanAvatar } from '../../../OrganizationFolderTree/components/PlanAvatar';

export function PlanTargetPopover({ anchor, assets, plans, onChoose, onDismiss }: {
  anchor: HTMLElement;
  assets: GroupingAsset[];
  plans: PlanDraft[];
  onChoose: (plan: PlanDraft) => void;
  onDismiss: () => void;
}) {
  const [query, setQuery] = useState('');
  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest('.asset-selection-popover') && !anchor.contains(event.target as Node)) onDismiss();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onDismiss(); };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', escape); };
  }, [anchor, onDismiss]);
  const rect = anchor.getBoundingClientRect();
  const above = rect.top - 16;
  const below = window.innerHeight - rect.bottom - 16;
  const opensBelow = below > above;
  const availableHeight = Math.max(0, (opensBelow ? below : above) - 8);
  const placement = opensBelow ? { top: rect.bottom + 8 } : { bottom: window.innerHeight - rect.top + 8 };
  const matching = plans.filter((plan) => plan.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const destinations = matching.filter((plan) => assets.some((asset) => !plan.assignedAssets?.some((assigned) => assigned.id === asset.id)));
  const invalid = assets.some((asset) => asset.valid === false);
  return createPortal(<Box className="asset-selection-popover" style={{ position: 'fixed', left: Math.max(16, Math.min(rect.right - 320, window.innerWidth - 336)), ...placement, maxHeight: Math.min(360, availableHeight), zIndex: 10001 }}>
    <Text variant="bodySmall">Choose a plan</Text>
    <input autoFocus aria-label="Search plans" placeholder="Search plans" value={query} onChange={(event) => setQuery(event.target.value)} />
    <Box className="asset-selection-plan-list">
      {matching.slice(0, 50).map((plan) => {
        const additions = assets.filter((asset) => !plan.assignedAssets?.some((assigned) => assigned.id === asset.id));
        const available = Math.max(0, planCapacity(plan) - planUsage(plan));
        return <button key={plan.id} type="button" disabled={invalid || !additions.length || additions.length > available} onClick={() => onChoose(plan)}>
          <PlanAvatar id={plan.id} />
          <Box flex={1} style={{ minWidth: 0 }} gap="xxs">
            <Text className="asset-selection-target-name" variant="bodySmall">{plan.name}</Text>
            <Text variant="xSmall" color="gray">{!additions.length ? 'Already assigned' : additions.length > available ? `${additions.length} spaces needed · ${available} available` : `${available} spaces available`}</Text>
          </Box>
        </button>;
      })}
      {!matching.length ? <Text variant="bodySmall" color="gray">{plans.length ? 'No matching plans.' : 'No plans available.'}</Text> : null}
      {matching.length > 50 ? <Text variant="bodySmall" color="gray">Showing 50 plans. Search to narrow results.</Text> : null}
      {invalid ? <Text variant="bodySmall" color="danger120">Selection contains invalid assets.</Text> : matching.length > 0 && !destinations.length ? <Text variant="bodySmall" color="gray">Choose another plan to move these assets.</Text> : destinations.length > 0 && destinations.every((plan) => assets.filter((asset) => !plan.assignedAssets?.some((assigned) => assigned.id === asset.id)).length > planCapacity(plan) - planUsage(plan)) ? <Text variant="bodySmall" color="gray">No destination has enough space for this selection.</Text> : null}
    </Box>
  </Box>, document.body);
}
