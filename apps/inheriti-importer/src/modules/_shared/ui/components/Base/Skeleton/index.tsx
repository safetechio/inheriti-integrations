import { Box } from '../../Primitives';
import './styles.css';

export function Skeleton({ height, width = '100%' }: { height: number; width?: number | string }) {
  return (
    <Box
      aria-hidden={true}
      className="importer-skeleton"
      width={width}
      height={height}
      backgroundColor="gray10"
      borderRadius="s"
      overflow="hidden"
      position="relative"
    />
  );
}
