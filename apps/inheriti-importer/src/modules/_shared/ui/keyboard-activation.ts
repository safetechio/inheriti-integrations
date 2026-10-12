/**
 * Keyboard-equivalent for a clickable `Box` that isn't a `Pressable` (e.g. one
 * that also needs native drag-and-drop props, which `Pressable` doesn't
 * expose). React-native-web's `View` forwards unrecognised DOM props
 * (`tabIndex`, `onKeyDown`) straight to the underlying element, the same way
 * `onClick`/`role`/`aria-*` already reach the DOM on these Boxes — so Enter/
 * Space here triggers the same handler a click does.
 */
/** Pass `stopPropagation: true` for a control nested inside another clickable
 *  Box (mirrors the `event.stopPropagation()` already required on its
 *  `onClick`, since native `keydown` bubbles the same way `click` does). */
export function keyboardActivation(
  onActivate: () => void,
  options?: { stopPropagation?: boolean },
) {
  return {
    tabIndex: 0,
    onKeyDown: (event: {
      key?: string;
      preventDefault?: () => void;
      stopPropagation?: () => void;
    }) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault?.();
        if (options?.stopPropagation) event.stopPropagation?.();
        onActivate();
      }
    },
  };
}
