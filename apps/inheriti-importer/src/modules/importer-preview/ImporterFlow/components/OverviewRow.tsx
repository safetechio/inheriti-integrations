import { Box, Text } from '@main-components';

type OverviewRowProps = { label: string; value: string };
export function OverviewRow({ label, value }: OverviewRowProps) {
  return (
    <Box gap="xxs">
      <Text variant="bodySmall" color="gray">
        {label}
      </Text>
      <Text variant="bodyRegular" semibold>
        {value}
      </Text>
    </Box>
  );
}
