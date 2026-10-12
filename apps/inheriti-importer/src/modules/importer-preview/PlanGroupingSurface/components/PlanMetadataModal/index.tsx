import { useEffect, useState } from 'react';
import { BaseModal, Button } from '@main-components';
import type { PlanDraft, PlanMetadataValues } from '../../types';
import { PlanDescriptionInput } from './components/PlanDescriptionInput';
import { PlanNameInput } from './components/PlanNameInput';

export type { PlanMetadataValues } from '../../types';

interface PlanMetadataModalProps {
  plan?: PlanDraft;
  visible: boolean;
  onDismiss: () => void;
  onSave: (values: PlanMetadataValues) => void;
}

export function PlanMetadataModal({ plan, visible, onDismiss, onSave }: PlanMetadataModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nameError, setNameError] = useState<string>();
  const [descriptionError, setDescriptionError] = useState<string>();

  useEffect(() => {
    if (!plan || !visible) return;
    setName(plan.name);
    setDescription(plan.description ?? '');
    setNameError(undefined);
    setDescriptionError(undefined);
  }, [plan?.id, visible]);

  const save = () => {
    const nextName = name.trim();
    const nextDescription = description.trim();
    if (!nextName) {
      setNameError('Plan name is required.');
      return;
    }
    if (nextName.length > 160) {
      setNameError('Plan name must be 160 characters or fewer.');
      return;
    }
    if (nextDescription.length > 2000) {
      setDescriptionError('Plan description must be 2000 characters or fewer.');
      return;
    }
    onSave({ name: nextName, description: nextDescription });
  };

  if (!plan) return null;

  return (
    <BaseModal
      visible={visible}
      title="Edit plan details"
      description="Update the draft name and description before staging."
      onDismiss={onDismiss}
      footer={
        <>
          <Button title="Cancel" variant="plain" onPress={onDismiss} />
          <Button title="Save details" onPress={save} />
        </>
      }
    >
      <PlanNameInput
        value={name}
        onChangeText={(value) => {
          setName(value);
          setNameError(undefined);
        }}
        error={nameError}
      />
      <PlanDescriptionInput
        value={description}
        onChangeText={(value) => {
          setDescription(value);
          setDescriptionError(undefined);
        }}
        error={descriptionError}
      />
    </BaseModal>
  );
}
