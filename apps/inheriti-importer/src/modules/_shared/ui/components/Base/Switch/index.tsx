import { Box } from '@modules/_shared/ui/components/Primitives';
import { keyboardActivation } from '@modules/_shared/ui/keyboard-activation';

/** Matches Business UI's switch spec: 43x22 pill track, 18x18 thumb, success on-color. */
export function Toggle({
  value,
  onValueChange,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Box
      width={43}
      height={22}
      borderRadius="pill"
      borderWidth={1}
      borderColor={value ? 'success120' : 'gray5'}
      backgroundColor={value ? 'success' : 'gray10'}
      flexDirection="row"
      alignItems="center"
      justifyContent={value ? 'flex-end' : 'flex-start'}
      style={{ paddingHorizontal: 2, cursor: 'pointer' }}
      onClick={(event: { stopPropagation?: () => void }) => {
        event.stopPropagation?.();
        onValueChange();
      }}
      {...keyboardActivation(onValueChange)}
      role="switch"
      aria-checked={value}
      aria-label={accessibilityLabel}
    >
      <Box width={18} height={18} borderRadius="pill" backgroundColor="white" />
    </Box>
  );
}
