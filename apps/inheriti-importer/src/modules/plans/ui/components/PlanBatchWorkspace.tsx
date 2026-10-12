import { useEffect } from 'react';
import { Alert, Box, Icon, Text } from '@modules/_shared/ui/components';
import Button from '@modules/_shared/ui/components/Base/Button';
import type { ImportSession } from '@modules/import/domain/import-model';
import type { PlanDraft } from '@modules/plans/domain/workspace-model';
import {
  createNoopTelemetrySink,
  type ImportTelemetrySink,
} from '@shared/infrastructure/telemetry';
import {
  usePlanBatchController,
  type PlanBatchControllerItem,
} from '@modules/batch/application/use-plan-batch-controller';

/**
 * Renders controller state only. All repository queries, snapshot/payload
 * construction, preflight, Organization Key acquisition, field-value
 * wrapping/staging, retry/cancel and telemetry live in
 * `usePlanBatchController` (`@modules/batch/application`).
 */
export function PlanBatchWorkspace({
  plans,
  session,
  onSuccess,
  onRunningChange,
  telemetry = createNoopTelemetrySink(),
}: {
  plans: PlanDraft[];
  session: ImportSession;
  onSuccess: () => void;
  onRunningChange?: (running: boolean) => void;
  telemetry?: ImportTelemetrySink;
}) {
  const controller = usePlanBatchController({ plans, session, onSuccess, telemetry });

  useEffect(() => onRunningChange?.(controller.running), [controller.running, onRunningChange]);

  if (plans.length === 0) return null;

  return (
    <Box
      gap="s"
      padding="m"
      backgroundColor="white"
      borderWidth={1}
      borderColor="primary30"
      borderRadius="s"
    >
      <Box flexDirection="row" justifyContent="flex-end" alignItems="center" gap="s">
        <Button
          title={controller.running ? 'Working…' : 'Stage import'}
          disabled={
            controller.running ||
            !controller.ready ||
            !controller.organizationId ||
            controller.organizationKey.configuredLoading ||
            controller.organizationKey.configured === false
          }
          onPress={controller.execute}
        />
        {controller.running ? (
          <Button title="Cancel" variant="plain" onPress={controller.cancel} />
        ) : null}
      </Box>
      <OrganizationKeyPanel
        organizationId={controller.organizationId}
        configured={controller.organizationKey.configured}
        loading={controller.organizationKey.configuredLoading}
        activePlanId={controller.organizationKey.activePlanId}
        step={controller.organizationKey.step}
        error={controller.organizationKey.error}
      />
      {controller.items.length > 0 ? (
        <Box gap="s" padding="m" backgroundColor="primary10" borderRadius="s">
          <Text variant="bodySmall" bold>
            Import process
          </Text>
          <Text variant="bodySmall" color="gray">
            Nothing is created yet — each Plan is staged for review, and a person promotes it into a
            real Plan from Inheriti® Business.
          </Text>
        </Box>
      ) : null}
      {controller.items.length > 0 ? (
        <BatchProgressSummary
          total={controller.items.length}
          staged={controller.result.complete.length}
          created={controller.result.createdUnconfigured.length}
          failed={controller.result.failed.length}
          cancelled={controller.result.cancelled.length}
          running={controller.running}
        />
      ) : null}
      {!controller.organizationId ? <Alert>Select an organization before importing.</Alert> : null}
      {!controller.ready ? (
        <Text variant="bodySmall" color="gray">
          Preparing plan configuration…
        </Text>
      ) : null}
      {controller.items.map((item) => (
        <BatchItem
          key={item.planId}
          item={item}
          onRetryCreate={() => controller.retryCreate(item.planId)}
          onRetryConfigure={() => controller.retryConfigure(item.planId)}
        />
      ))}
    </Box>
  );
}

function BatchProgressSummary({
  total,
  staged,
  created,
  failed,
  cancelled,
  running,
}: {
  total: number;
  staged: number;
  created: number;
  failed: number;
  cancelled: number;
  running: boolean;
}) {
  const finished = staged + created + failed + cancelled;
  const percentage = Math.min(100, Math.round((finished / total) * 100));
  return (
    <Box gap="s" padding="m" backgroundColor="gray5" borderRadius="s">
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text variant="bodySmall" bold>
          {running ? 'Staging in progress' : 'Staging result'}
        </Text>
        <Text variant="bodySmall" color="gray">
          {finished} of {total} Plans · {percentage}%
        </Text>
      </Box>
      <Box height={6} backgroundColor="gray10" borderRadius="s" overflow="hidden">
        <Box
          height={6}
          width={`${percentage}%`}
          backgroundColor={failed > 0 ? 'warning' : 'success'}
          borderRadius="s"
        />
      </Box>
      <Text variant="bodySmall" color="gray">
        Staged: {staged} · Pending: {created} · Failed: {failed} · Cancelled: {cancelled}
      </Text>
    </Box>
  );
}

function OrganizationKeyPanel({
  organizationId,
  configured,
  loading,
  activePlanId,
  step,
  error,
}: {
  organizationId?: string;
  configured?: boolean;
  loading: boolean;
  activePlanId: string | null;
  step: string;
  error?: string | null;
}) {
  const offline = Boolean(error && /network|offline|fetch|timeout|connection/i.test(error));
  const expired = Boolean(error && /401|unauthori[sz]ed|session.*expir|login.*again/i.test(error));
  const releasing = !!activePlanId;
  const status = !organizationId
    ? 'Select an organization'
    : offline
      ? 'Offline'
      : expired
        ? 'Session expired'
        : loading
          ? 'Checking configuration…'
          : configured === false
            ? 'Not configured'
            : step === 'not-claimed'
              ? 'Waiting for SafeKey claim'
              : releasing
                ? step === 'available'
                  ? 'Organization Key released — staging…'
                  : 'Waiting for SafeKey to release this Plan’s key'
                : 'Configured — release required when staging';
  const color =
    !organizationId || configured === false || step === 'not-claimed' || offline || expired
      ? 'danger'
      : releasing
        ? 'primary120'
        : 'success120';
  return (
    <Box
      gap="s"
      padding="m"
      borderWidth={1}
      borderColor={configured === false ? 'danger30' : 'primary30'}
      borderRadius="s"
      backgroundColor="primary5"
    >
      <Box flexDirection="row" alignItems="center" gap="s">
        <Icon
          name={configured === false ? 'circle-exclamation' : releasing ? 'key' : 'circle-check'}
          type="font-awesome-6"
          color={color}
          label="Organization Key status"
        />
        <Box flex={1} gap="xs">
          <Text variant="bodySmall" bold>
            Organization Key
          </Text>
          <Text variant="bodySmall" color={color}>
            {status}
          </Text>
        </Box>
      </Box>
      <Text variant="bodySmall" color="gray">
        Each Plan releases the Organization Key on its own turn during import — approve it on your
        SafeKey device when prompted.
      </Text>
      {!organizationId ? (
        <Text variant="bodySmall" color="gray">
          Choose an organization before importing.
        </Text>
      ) : null}
      {configured === false ? (
        <Alert>Configure the Organization Key in Inheriti® Business before importing.</Alert>
      ) : null}
      {offline ? <Alert>Reconnect to Inheriti® Business and try again.</Alert> : null}
      {expired ? <Alert>Sign in again to continue this import.</Alert> : null}
      {step === 'not-claimed' ? (
        <Alert>The Organization Key has not been claimed on a SafeKey device.</Alert>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
    </Box>
  );
}

function BatchItem({
  item,
  onRetryCreate,
  onRetryConfigure,
}: {
  item: PlanBatchControllerItem;
  onRetryCreate: () => void;
  onRetryConfigure: () => void;
}) {
  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      padding="s"
      backgroundColor="gray5"
      borderRadius="s"
    >
      <Text variant="bodySmall">
        {item.planId} · {stagingStatusLabel(item.status)}
      </Text>
      {item.status === 'FAILED_CREATE' ? (
        <Button title="Retry" variant="plain" size="sm" onPress={onRetryCreate} />
      ) : item.status === 'FAILED_CONFIGURE' || item.status === 'CREATED' ? (
        <Button title="Retry staging" variant="plain" size="sm" onPress={onRetryConfigure} />
      ) : null}
      {item.error ? <Alert>{safeError(item.error)}</Alert> : null}
    </Box>
  );
}

/**
 * A batch item's terminal state is `COMPLETE` (staged) or `FAILED_CONFIGURE`
 * (failed to stage) — the underlying executor's status names describe the
 * generic "create then configure" shape it was built for, not what this
 * step actually does here, so this only relabels them for display.
 */
function stagingStatusLabel(status: string): string {
  switch (status) {
    case 'COMPLETE':
      return 'STAGED';
    case 'FAILED_CREATE':
    case 'FAILED_CONFIGURE':
      return 'FAILED_STAGE';
    case 'CONFIGURING':
      return 'STAGING';
    case 'CREATED':
      return 'READY_TO_STAGE';
    default:
      return status;
  }
}

function safeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object') {
    const value = error as { errorDescription?: string; message?: string };
    return value.errorDescription || value.message || 'The operation failed.';
  }
  return 'The operation failed.';
}
