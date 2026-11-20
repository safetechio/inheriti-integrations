import { Box, Skeleton } from '@main-components';

export function FolderImpactSkeleton() {
  return (
    <Box
      role="status"
      aria-busy={true}
      aria-label="Loading impact"
      gap="xs"
      backgroundColor="gray5"
      borderRadius="s"
      padding="m"
      borderWidth={1}
      borderColor="gray10"
    >
      <Skeleton width={90} height={18} />
      <Skeleton width={120} height={18} />
      <Skeleton width="72%" height={18} />
    </Box>
  );
}
