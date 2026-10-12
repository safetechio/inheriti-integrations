import { Box, Pressable } from '@modules/_shared/ui/components/Primitives';
import { Icon } from '@modules/_shared/ui/components/Base/Icon';
import { keyboardActivation } from '@modules/_shared/ui/keyboard-activation';

/**
 * A small square icon-only button — row actions (edit/delete/move/…).
 * `react-native-web`'s `Pressable` does not itself react to Enter/Space on
 * web (confirmed empirically: it forwards `onKeyDown` but never calls
 * `onPress` for it) — `keyboardActivation` supplies that.
 */
export function IconAction({
  name,
  label,
  onPress,
  disabled,
}: {
  name: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(disabled ? {} : keyboardActivation(onPress))}
    >
      <Box
        width={28}
        height={28}
        borderRadius="s"
        alignItems="center"
        justifyContent="center"
        opacity={disabled ? 0.4 : 1}
      >
        <Icon name={name} type="font-awesome-6" size={14} color="gray" label="" />
      </Box>
    </Pressable>
  );
}

export default IconAction;
