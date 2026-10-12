import { Alert, Text } from '@main-components';
import type { PlanDraft } from '../types';
export function PlanAlerts({
  plan,
  dropState,
  showGovernance,
}: {
  plan: PlanDraft;
  dropState: string;
  showGovernance: boolean;
}) {
  return (
    <>
      {dropState === 'over-valid' ? (
        <Alert tone="success" dismissable={false}>
          Drop to assign this Asset to {plan.name}.
        </Alert>
      ) : null}
      {dropState === 'over-invalid' ? (
        <Alert tone="warning" dismissable={false}>
          This Plan cannot accept the dragged Asset.
        </Alert>
      ) : null}
      {plan.capacityWarning ? (
        <Alert tone="warning" dismissable={false}>
          Advisory capacity warning. Inheriti® Business will revalidate authoritative limits.
        </Alert>
      ) : null}
      {showGovernance && plan.governanceHint ? (
        <Text variant="bodySmall" color="gray">
          Provisional governance: {plan.governanceHint}
        </Text>
      ) : null}
    </>
  );
}
