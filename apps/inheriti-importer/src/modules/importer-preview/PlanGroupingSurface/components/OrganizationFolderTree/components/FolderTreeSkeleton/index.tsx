import { Box, Skeleton, Text } from '@main-components';
import '../FolderPendingStatus/styles.css';

export function FolderTreeSkeleton() {
  return (
    <Box role="status" aria-label="Loading folders…" aria-busy={true}>
      <Text className="folder-pending-label">Loading folders…</Text>
      {['76%', '55%', '66%'].map((width) => (
        <Box
          key={width}
          flexDirection="row"
          alignItems="center"
          gap="s"
          minHeight={52}
          paddingHorizontal="m"
          style={{ borderBottomWidth: 1, borderBottomColor: 'var(--gray-10)' }}
        >
          <Skeleton width={20} height={18} />
          <Box flex={1} style={{ minWidth: 0 }}>
            <Skeleton width={width} height={12} />
          </Box>
          <Skeleton width={36} height={12} />
          <Box width={24} />
        </Box>
      ))}
    </Box>
  );
}
