import { useEffect, useState, type ComponentProps } from 'react';
import { Controller, useForm, type Control, type RegisterOptions } from 'react-hook-form';
import { ModalPortal } from '@modules/_shared/ui/components/Base/Portal';
import { Alert, Box, FormTextInput, Icon, Pressable, Text } from '@modules/_shared/ui/components';
import { keyboardActivation } from '@modules/_shared/ui/keyboard-activation';
import Button from '@modules/_shared/ui/components/Base/Button';
import type { PlanDraft } from '@modules/plans/domain/workspace-model';
import {
  useFindActiveOrganizationPlanCategoriesByCriteria,
  useFindSelectedOrganizationPlanCreationTeamsByCriteria,
  useGetRawSelectedOrganizationId,
  useSelectedOrganizationMemberCapabilities,
  useSaveOrganizationPlanCategory,
  usePlanCreationOrgPolicy,
} from '@modules/organization/infrastructure/importer-api';

type PlanDetailsValues = {
  name: string;
  description: string;
  categoryId: string;
  sharingModel: 'SHARED' | 'PRIVATE';
  moderatedAccess: boolean;
  authenticationMethodIds: string;
  authenticationMode: 'EXCLUSIVE' | 'ALL_REQUIRED';
  approvalMode: 'THRESHOLD' | 'UNANIMOUS';
  requestedMinimumApprovals: string;
  teamIds: string;
};

/**
 * `react-hook-form`'s `register()` (ref-based) never actually updates the
 * form's tracked value here — react-native-web's `TextInput` re-merges its
 * forwarded ref (`useMergeRefs`) whenever the ref identity changes, which
 * silently re-registers the field back to its default. `Controller`'s
 * `value`/`onChange` pair sidesteps the ref path entirely and is the pattern
 * this file already uses correctly for `newCategoryName`/team selection.
 */
function ControlledTextInput({
  control,
  name,
  rules,
  label,
  ...props
}: {
  control: Control<PlanDetailsValues>;
  name: keyof PlanDetailsValues;
  rules?: RegisterOptions<PlanDetailsValues>;
  label: string;
} & Omit<ComponentProps<typeof FormTextInput>, 'value' | 'onChangeText' | 'label'>) {
  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      render={({ field }) => (
        <FormTextInput
          label={label}
          value={String(field.value ?? '')}
          onChangeText={field.onChange}
          {...props}
        />
      )}
    />
  );
}

export function PlanDetailsModal({
  plan,
  onSave,
  onDismiss,
}: {
  plan: PlanDraft | null;
  onSave: (values: PlanDetailsValues) => void;
  onDismiss: () => void;
}) {
  const policy = usePlanCreationOrgPolicy();
  const { data: organizationId } = useGetRawSelectedOrganizationId();
  const { canCreatePlanCategories } = useSelectedOrganizationMemberCapabilities();
  const { save: saveCategory, loading: categorySaving } = useSaveOrganizationPlanCategory();
  const { data: categories } = useFindActiveOrganizationPlanCategoriesByCriteria(
    undefined,
    undefined,
    undefined,
    { enabled: !!plan },
  );
  const { data: teams } = useFindSelectedOrganizationPlanCreationTeamsByCriteria(
    undefined,
    undefined,
    undefined,
    { enabled: !!plan },
  );
  const {
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    trigger,
    setError,
    formState: { errors },
  } = useForm<PlanDetailsValues>({
    defaultValues: emptyValues,
  });

  useEffect(() => {
    if (!plan) return;
    setStep(0);
    reset({
      name: plan.name,
      description: plan.description ?? '',
      categoryId: plan.categoryId ?? '',
      sharingModel: plan.governance.sharingModel,
      moderatedAccess: plan.governance.moderatedAccess,
      authenticationMethodIds: plan.governance.authenticationMethodIds.join(', '),
      authenticationMode: plan.governance.authenticationMode ?? 'EXCLUSIVE',
      approvalMode: plan.governance.approvalMode ?? policy.approvalMode,
      requestedMinimumApprovals: String(plan.governance.requestedMinimumApprovals ?? 1),
      teamIds: plan.teamIds.join(', '),
    });
  }, [plan, reset]);

  const [step, setStep] = useState(0);
  const [newCategoryName, setNewCategoryName] = useState('');
  if (!plan) return null;
  const sharingModel = watch('sharingModel');
  const moderatedAccess = watch('moderatedAccess');
  const authenticationMethodIds = watch('authenticationMethodIds');
  const teamIds = watch('teamIds');
  const steps = ['Details', 'Access', 'Review'];

  return (
    <ModalPortal visible onRequestClose={onDismiss}>
      <Box flex={1} justifyContent="center" alignItems="center" style={styles.backdrop}>
        <Box
          accessibilityRole="dialog"
          accessibilityLabel="Plan details"
          {...{ 'aria-modal': true }}
          gap="m"
          width="100%"
          maxWidth={560}
          padding="l"
          backgroundColor="white"
          borderRadius="s"
        >
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Text variant="heading3">Plan details</Text>
            <Pressable
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel="Close plan details"
              {...keyboardActivation(onDismiss)}
            >
              <Icon name="xmark" type="font-awesome-6" color="gray" />
            </Pressable>
          </Box>
          <Box flexDirection="row" gap="s">
            {steps.map((label, index) => (
              <Button
                key={label}
                title={`${index + 1}. ${label}`}
                variant={step === index ? 'contained' : 'plain'}
                size="sm"
                onPress={() => setStep(index)}
              />
            ))}
          </Box>
          <Text variant="bodySmall">
            Complete the Plan configuration before creating it in Inheriti® Business.
          </Text>
          {step === 0 ? (
            <>
              <ControlledTextInput
                label="Plan title"
                control={control}
                name="name"
                rules={{
                  required: 'Title is required',
                  maxLength: { value: 160, message: 'Title is too long' },
                }}
                placeholder="Title"
                accessibilityLabel="Plan title"
              />
              {errors.name ? <Alert>{errors.name.message}</Alert> : null}
              <ControlledTextInput
                label="Plan description"
                control={control}
                name="description"
                rules={{ maxLength: { value: 2000, message: 'Description is too long' } }}
                placeholder="Description"
                accessibilityLabel="Plan description"
                multiline
              />
              {errors.description ? <Alert>{errors.description.message}</Alert> : null}
              <ControlledTextInput
                label="Plan category"
                control={control}
                name="categoryId"
                placeholder="Category id (optional)"
                accessibilityLabel="Plan category"
              />
              {categories ? (
                <Text variant="bodySmall" color="gray">
                  Available categories:{' '}
                  {Object.values(categories)
                    .map((category) => `${category.id} (${category.name})`)
                    .join(', ') || 'none'}
                </Text>
              ) : null}
              {canCreatePlanCategories ? (
                <Box flexDirection="row" gap="s" alignItems="center">
                  <FormTextInput
                    label="New category name"
                    value={newCategoryName}
                    onChangeText={setNewCategoryName}
                    placeholder="New category name"
                    accessibilityLabel="New category name"
                  />
                  <Button
                    title={categorySaving ? 'Creating…' : 'Create category'}
                    size="sm"
                    disabled={categorySaving || !organizationId || !newCategoryName.trim()}
                    onPress={async () => {
                      if (!organizationId) return;
                      const id = crypto.randomUUID();
                      await saveCategory({
                        id,
                        organizationId,
                        name: newCategoryName.trim(),
                        status: 'ACTIVE',
                        createdAt: new Date(),
                      });
                      setValue('categoryId', id);
                      setNewCategoryName('');
                    }}
                  />
                </Box>
              ) : null}
              <ControlledTextInput
                label="Plan teams"
                control={control}
                name="teamIds"
                placeholder="Plan-creation team ids (comma separated)"
                accessibilityLabel="Plan teams"
              />
              {teams ? (
                <Box gap="s">
                  <Text variant="bodySmall" color="gray">
                    Select valid plan-creation teams:
                  </Text>
                  <Box flexDirection="row" gap="s" flexWrap="wrap">
                    {Object.values(teams).map((team) => {
                      const selected = teamIds
                        .split(',')
                        .map((id) => id.trim())
                        .filter(Boolean)
                        .includes(team.id);
                      return (
                        <Button
                          key={team.id}
                          title={team.name}
                          variant={selected ? 'contained' : 'plain'}
                          size="sm"
                          onPress={() => {
                            const selectedIds = new Set(
                              teamIds
                                .split(',')
                                .map((id) => id.trim())
                                .filter(Boolean),
                            );
                            if (selected) selectedIds.delete(team.id);
                            else selectedIds.add(team.id);
                            setValue('teamIds', Array.from(selectedIds).join(', '));
                          }}
                        />
                      );
                    })}
                  </Box>
                </Box>
              ) : null}
            </>
          ) : null}
          {step === 1 ? (
            <>
              <Text variant="bodySmall" bold>
                Sharing model
              </Text>
              <Box flexDirection="row" gap="s">
                <Button
                  title="Shared"
                  variant={sharingModel === 'SHARED' ? 'contained' : 'plain'}
                  size="sm"
                  onPress={() => setValue('sharingModel', 'SHARED')}
                />
                <Button
                  title="Private"
                  variant={sharingModel === 'PRIVATE' ? 'contained' : 'plain'}
                  size="sm"
                  disabled={!policy.privateAllowed}
                  onPress={() => setValue('sharingModel', 'PRIVATE')}
                />
              </Box>
              <Button
                title={moderatedAccess ? 'Moderation enabled' : 'Enable moderation'}
                variant="plain"
                size="sm"
                disabled={policy.moderationRequired}
                onPress={() => setValue('moderatedAccess', !moderatedAccess)}
              />
              {policy.moderationRequired ? (
                <Text variant="bodySmall" color="warning120">
                  Organization settings require moderation.
                </Text>
              ) : null}
              <ControlledTextInput
                label="Authentication methods"
                control={control}
                name="authenticationMethodIds"
                placeholder="Authentication method ids (comma separated)"
                accessibilityLabel="Authentication methods"
              />
              {policy.authRequired ? (
                <Text variant="bodySmall" color="warning120">
                  Organization settings require authentication.
                </Text>
              ) : null}
              {Object.keys(policy.enabledMethods).length > 0 ? (
                <Text variant="bodySmall" color="gray">
                  Enabled methods:{' '}
                  {Object.keys(policy.enabledMethods)
                    .filter((id) => policy.enabledMethods[id])
                    .join(', ') || 'none'}
                </Text>
              ) : null}
              <ControlledTextInput
                label="Authentication mode"
                control={control}
                name="authenticationMode"
                placeholder="Authentication mode: EXCLUSIVE or ALL_REQUIRED"
                accessibilityLabel="Authentication mode"
              />
              <ControlledTextInput
                label="Approval mode"
                control={control}
                name="approvalMode"
                placeholder="Approval mode: THRESHOLD or UNANIMOUS"
                accessibilityLabel="Approval mode"
              />
              {moderatedAccess ? (
                <ControlledTextInput
                  label="Minimum approvals"
                  control={control}
                  name="requestedMinimumApprovals"
                  rules={{
                    pattern: { value: /^\d+$/, message: 'Minimum approvals must be a number' },
                  }}
                  placeholder="Minimum moderator approvals"
                  accessibilityLabel="Minimum approvals"
                  keyboardType="numeric"
                />
              ) : null}
              {errors.requestedMinimumApprovals ? (
                <Alert>{errors.requestedMinimumApprovals.message}</Alert>
              ) : null}
            </>
          ) : null}
          {step === 2 ? (
            <Box gap="s" padding="m" backgroundColor="primary10" borderRadius="s">
              <Text variant="bodyRegular" bold>
                {watch('name') || 'Untitled Plan'}
              </Text>
              <Text variant="bodySmall">{watch('description') || 'No description'}</Text>
              <Text variant="bodySmall">Category: {watch('categoryId') || 'None'}</Text>
              <Text variant="bodySmall">
                {sharingModel} · {moderatedAccess ? 'Moderated' : 'Unmoderated'}
              </Text>
              <Text variant="bodySmall" color="gray">
                Authentication methods: {authenticationMethodIds || 'None'}
              </Text>
            </Box>
          ) : null}
          <Box flexDirection="row" justifyContent="flex-end" gap="s">
            <Button title="Cancel" variant="plain" onPress={onDismiss} />
            {step > 0 ? (
              <Button
                title="Back"
                variant="plain"
                onPress={() => setStep((current) => current - 1)}
              />
            ) : null}
            {step < steps.length - 1 ? (
              <Button
                title="Next"
                onPress={async () => {
                  if (step === 0 && !(await trigger('name'))) return;
                  setStep((current) => current + 1);
                }}
              />
            ) : (
              <Button
                title="Save details"
                onPress={handleSubmit((values) => {
                  const methodIds = values.authenticationMethodIds
                    .split(',')
                    .map((id) => id.trim())
                    .filter(Boolean);
                  const enabledMethods = new Set(
                    Object.keys(policy.enabledMethods).filter((id) => policy.enabledMethods[id]),
                  );
                  if (!policy.privateAllowed && values.sharingModel === 'PRIVATE') {
                    setError('sharingModel', {
                      message: 'Private plans are disabled by organization settings.',
                    });
                    return;
                  }
                  if (
                    (policy.authRequired || values.sharingModel === 'PRIVATE') &&
                    methodIds.length === 0
                  ) {
                    setError('authenticationMethodIds', {
                      message: 'At least one authentication method is required.',
                    });
                    return;
                  }
                  if (enabledMethods.size > 0 && methodIds.some((id) => !enabledMethods.has(id))) {
                    setError('authenticationMethodIds', {
                      message:
                        'One or more authentication methods are disabled by organization settings.',
                    });
                    return;
                  }
                  onSave(values);
                })}
              />
            )}
          </Box>
        </Box>
      </Box>
    </ModalPortal>
  );
}

const emptyValues: PlanDetailsValues = {
  name: '',
  description: '',
  categoryId: '',
  sharingModel: 'SHARED',
  moderatedAccess: false,
  authenticationMethodIds: '',
  authenticationMode: 'EXCLUSIVE',
  approvalMode: 'THRESHOLD',
  requestedMinimumApprovals: '1',
  teamIds: '',
};
const styles = {
  backdrop: {
    backgroundColor: 'rgba(10, 28, 77, 0.32)',
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 9999,
  },
} as const;
