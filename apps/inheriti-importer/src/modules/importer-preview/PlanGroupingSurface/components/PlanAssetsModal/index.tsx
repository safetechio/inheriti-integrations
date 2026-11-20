import { useEffect, useState } from 'react';
import { BaseModal, Box, Button, Meter, Stack, Text } from '@main-components';
import { planCapacity, planUsage } from '../../capacity';
import type { Folder, PlanDraft, PlanMetadataValues } from '../../types';
import { PlanNameInput } from '../PlanMetadataModal/components/PlanNameInput';
import { PlanDescriptionInput } from '../PlanMetadataModal/components/PlanDescriptionInput';
import { ModalAssetRow } from './components/ModalAssetRow';
import { PlanAvatar } from '../OrganizationFolderTree/components/PlanAvatar';

export function PlanAssetsModal({ plan, folders, onDismiss, onSave, onDelete, onRemove }: {
  plan?: PlanDraft;
  folders: Folder[];
  onDismiss: () => void;
  onSave?: (plan: PlanDraft, values: PlanMetadataValues) => void;
  onDelete?: (plan: PlanDraft) => void;
  onRemove?: (asset: NonNullable<PlanDraft['assignedAssets']>[number], plan: PlanDraft) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string>();
  useEffect(() => {
    setName(plan?.name ?? '');
    setDescription(plan?.description ?? '');
    setError(undefined);
  }, [plan?.id]);
  const location = plan?.folderId ? folders.find((folder) => folder.id === plan.folderId)?.name ?? 'Unknown folder' : 'Organisation root';
  const save = () => {
    if (!plan || !onSave) return;
    const nextName = name.trim();
    if (!nextName) return setError('Plan name is required.');
    if (nextName.length > 160) return setError('Plan name must be 160 characters or fewer.');
    if (description.trim().length > 2000) return setError('Plan description must be 2000 characters or fewer.');
    onSave(plan, { name: nextName, description: description.trim() });
    onDismiss();
  };
  return (
    <BaseModal visible={Boolean(plan)} title={plan?.name ?? 'Draft plan'} titleIcon={plan ? <PlanAvatar id={plan.id} /> : undefined} description="Draft plan details and assigned Assets" onDismiss={onDismiss} footer={<>
      {plan && onDelete ? <Button title="Delete plan" color="danger" variant="plain" onPress={() => onDelete(plan)} /> : null}
      <Button title="Close" variant="outlined" color="gray" onPress={onDismiss} />
      {onSave ? <Button title="Save details" onPress={save} /> : null}
    </>}>
      {plan ? <Stack gap="m">
        {onSave ? <><PlanNameInput value={name} onChangeText={(value) => { setName(value); setError(undefined); }} error={error} /><PlanDescriptionInput value={description} onChangeText={(value) => { setDescription(value); setError(undefined); }} error={error?.startsWith('Plan description') ? error : undefined} /></> : <Text variant="bodyRegular">{plan.description}</Text>}
        <Text variant="bodySmall" color="gray">Location in your organisation: {location}</Text>
        <Box gap="xs"><Text variant="bodySmall" color="gray">{planUsage(plan)} of {planCapacity(plan)} Assets</Text><Meter value={planUsage(plan)} max={planCapacity(plan)} label={`${planUsage(plan)} of ${planCapacity(plan)} assets used`} tone={planUsage(plan) > planCapacity(plan) ? 'danger' : 'success'} /></Box>
        <Stack gap="xs"><Text variant="bodyRegular" semibold>Assets in this plan</Text>{plan.assignedAssets?.length ? plan.assignedAssets.map((asset) => <ModalAssetRow key={asset.id} asset={asset} onRemove={onRemove ? () => onRemove(asset, plan) : undefined} />) : <Text variant="bodySmall" color="gray">No Assets assigned yet.</Text>}</Stack>
      </Stack> : null}
    </BaseModal>
  );
}
