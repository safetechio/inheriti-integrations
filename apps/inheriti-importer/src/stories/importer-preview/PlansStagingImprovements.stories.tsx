import { PlanGroupingSurface, type PlanDraft } from '@modules/importer-preview/PlanGroupingSurface';
import {
  FinalStagingChecklist,
  type ChecklistItem,
} from '@modules/importer-preview/FinalStagingChecklist';
import { StagingBatchStatus } from '@modules/importer-preview/StagingBatchStatus';

const noop = () => undefined;
const asset = { id: 'asset-1', name: 'Production database', type: 'CREDENTIAL', valid: true };
const first: PlanDraft = {
  id: 'first',
  name: 'Plan 1',
  assets: 0,
  capacity: '0 / 10 Assets',
  valid: false,
  assignedAssets: [],
};
const second: PlanDraft = {
  id: 'second',
  name: 'Operations',
  assets: 1,
  capacity: '1 / 10 Assets',
  valid: true,
  assignedAssets: [asset],
};
const actions = {
  onCreatePlan: noop,
  onDeletePlan: noop,
  onSelectPlan: noop,
  onAssign: noop,
  onUnassign: noop,
};
const key = (complete = false, loading = false, error?: string): ChecklistItem => ({
  label: 'Load Organisation Key',
  detail: complete
    ? 'Key securely loaded.'
    : loading
      ? 'Waiting for SafeKey Mobile to release the key.'
      : 'Send a key release request to SafeKey Mobile.',
  complete,
  loading,
  error,
  fixLabel: loading ? 'Cancel request' : 'Send request to SafeKey Mobile',
  onFix: noop,
});
const secure = (complete = false, loading = false, error?: string): ChecklistItem => ({
  label: 'Secure staging',
  detail: loading
    ? 'Encrypting data & transmitting to Inheriti® Business for staging.'
    : 'Locally encrypt all data prior to transmission to Inheriti® Business.',
  complete,
  loading,
  error,
});
const stagingActions = { onStage: noop, onRetry: noop, onStartAgain: noop };

export const SingleEmptyDraft = () => (
  <PlanGroupingSurface unassigned={[asset]} plans={[first]} selectedPlanId="first" {...actions} />
);
export const MultipleDrafts = () => (
  <PlanGroupingSurface
    unassigned={[asset]}
    plans={[second, first]}
    selectedPlanId="second"
    {...actions}
  />
);
export const AllAssetsAssigned = () => (
  <PlanGroupingSurface unassigned={[]} plans={[second]} selectedPlanId="second" {...actions} />
);
export const StagingAwaitingKey = () => (
  <FinalStagingChecklist
    state="waiting-release"
    items={[key(), secure()]}
    canStage={false}
    {...stagingActions}
  />
);
export const StagingKeyRequestPending = () => (
  <FinalStagingChecklist
    state="releasing"
    items={[key(false, true), secure()]}
    canStage={false}
    {...stagingActions}
  />
);
export const StagingKeyReleaseFailed = () => (
  <FinalStagingChecklist
    state="waiting-release"
    items={[key(false, false, 'Request failed. Retry the release.'), secure()]}
    canStage={false}
    {...stagingActions}
  />
);
export const StagingKeyLoaded = () => (
  <FinalStagingChecklist
    state="verified"
    items={[key(true), secure()]}
    canStage
    {...stagingActions}
  />
);
export const StagingEncrypting = () => (
  <FinalStagingChecklist
    state="encrypting"
    items={[key(true), secure(false, true)]}
    canStage
    {...stagingActions}
  />
);
export const StagingPartialFailure = () => (
  <>
    <FinalStagingChecklist
      state="retry"
      items={[key(true), secure(false, false, 'One plan failed to stage.')]}
      canStage
      {...stagingActions}
    />
    <StagingBatchStatus
      items={[
        { planId: 'first', status: 'FAILED_CONFIGURE' },
        { planId: 'second', status: 'COMPLETE' },
      ]}
      plans={[first, second]}
      running={false}
      onRetryCreate={noop}
      onRetryConfigure={noop}
      onCancel={noop}
    />
  </>
);
export const StagingOnePlanProgress = () => (
  <StagingBatchStatus
    items={[{ planId: 'first', status: 'PENDING' }]}
    plans={[first]}
    running
    onRetryCreate={noop}
    onRetryConfigure={noop}
    onCancel={noop}
  />
);
export const StagingSuccess = () => (
  <FinalStagingChecklist state="staged" items={[key(true), secure(true)]} {...stagingActions} />
);
