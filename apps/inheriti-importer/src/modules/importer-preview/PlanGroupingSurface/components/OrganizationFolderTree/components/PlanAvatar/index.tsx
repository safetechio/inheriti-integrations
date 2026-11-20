import { Image } from 'react-native-web';
import { planAvatarSvg } from '@safetech/inheriti-elements-brand';
import { Box } from '@main-components';

export function PlanAvatar({ id }: { id: string }) {
  return <Box className="plan-mosaic" style={{ width: 30, height: 30, flexShrink: 0 }}><Image accessibilityLabel="Plan avatar" source={{ uri: `data:image/svg+xml,${encodeURIComponent(planAvatarSvg(id))}` }} style={{ width: 30, height: 30 }} /></Box>;
}
