import { Card, Stack, Text } from '@main-components';
import type { PlanDraft } from '../types';

export function PlanDetails({ plan }: { plan?: PlanDraft }) {
  return (
    <Card className="plan-grouping-details" style={{ flex: '0 0 320px', alignSelf: 'flex-start' }}>
      <Stack gap="s">
        <Text variant="heading3">Selected Plan details</Text>
        {plan ? (
          <>
            <Text variant="bodySmall" color="gray">
              {plan.name} · draft metadata only
            </Text>
            <Text variant="bodySmall" color="gray">
              {plan.assets} Assets · {plan.capacity}
            </Text>
            <Text variant="bodySmall" color="gray">
              Recipients and access policy are configured in Inheriti® Business.
            </Text>
          </>
        ) : (
          <Text variant="bodySmall" color="gray">
            Select a Plan to inspect its draft details.
          </Text>
        )}
      </Stack>
    </Card>
  );
}
