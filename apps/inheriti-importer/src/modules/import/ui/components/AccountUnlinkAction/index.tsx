import { useEffect, useRef } from 'react';
import { Box, Pressable, Text } from '@modules/_shared/ui/components';

export function AccountUnlinkAction({ name, onPress }: { name: string; onPress: () => void }) {
  const label = `Unlink ${name} from this device`;
  const tooltip = useRef<HTMLElement | null>(null);
  useEffect(() => { tooltip.current?.setAttribute('title', label); }, [label]);
  return (
    <Box ref={tooltip} className="account-menu-remove">
      <Pressable accessibilityRole="menuitem" accessibilityLabel={label} onPress={onPress}
        style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
        <Text color="gray" style={{ fontSize: 19, lineHeight: 19 }}>×</Text>
      </Pressable>
    </Box>
  );
}
