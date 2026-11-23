import { useAnchoredPopover } from '@modules/_shared/ui/hooks/use-anchored-popover';
import { createPortal } from 'react-dom';
import { Box, Icon, Text } from '@main-components';
import '../../../PlanGroupingSurface/components/SelectionHelpPopover/styles.css';

const steps = [
  [
    'Select',
    'Checkbox or Ctrl/Cmd+click to toggle. Shift+click selects a range. Ctrl/Cmd+A selects all matching assets from the list.',
  ],
  [
    'Select an area',
    'Drag from a gap to select nearby assets. Ctrl/Cmd+drag from an asset row adds to the selection.',
  ],
  [
    'Review',
    'A accepts and X excludes the selection or inspected asset. Use ↑ and ↓ to inspect assets. Ctrl/Cmd+Shift+A accepts all eligible assets.',
  ],
  ['Clear', 'Escape clears the selection.'],
];

export function ReviewSelectionHelp() {
  const { open, setOpen, triggerRef, panelRef, position } = useAnchoredPopover();
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="selection-help-trigger"
        aria-label="Asset review selection help"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="circle-question" type="font-awesome-6" size={15} color="gray" label="" />
      </button>
      {open
        ? createPortal(
            <Box
              ref={panelRef}
              className="selection-help-popover asset-review-help-panel"
              style={{ position: 'fixed', ...position, zIndex: 10002 }}
              role="region"
              aria-label="Asset review selection help"
            >
              <Text variant="bodyRegular" semibold>
                Asset review controls
              </Text>
              {steps.map(([heading, detail], index) => (
                <Box
                  key={heading}
                  className="selection-help-group"
                  borderColor="gray10"
                  borderWidth={1}
                  borderRadius="s"
                >
                  <Box flexDirection="row" alignItems="center" gap="s">
                    <Box className="selection-help-number" borderRadius="s" backgroundColor="gray5">
                      <Text variant="bodySmall" semibold>
                        {index + 1}
                      </Text>
                    </Box>
                    <Text variant="bodySmall" semibold accessibilityRole="heading">
                      {heading}
                    </Text>
                  </Box>
                  <Text variant="bodySmall">{detail}</Text>
                </Box>
              ))}
            </Box>,
            document.body,
          )
        : null}
    </>
  );
}
