import { useId, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Box, Icon, Text, theme } from '@main-components';
import { useAnchoredPopover } from '@modules/_shared/ui/hooks/use-anchored-popover';
import './styles.css';

type ReviewMenuItem = {
  label: string;
  description: string;
  icon: string;
  disabled?: boolean;
  onSelect: () => void;
};

export function ReviewActionsMenu({ label, items }: { label: string; items: ReviewMenuItem[] }) {
  const { open, setOpen, triggerRef, panelRef, position } = useAnchoredPopover();
  const id = useId();
  useLayoutEffect(() => {
    if (open)
      panelRef.current
        ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
        ?.focus({ preventScroll: true });
  }, [open, panelRef]);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="asset-review-actions-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <Box aria-hidden={true}>
          <Icon name="ellipsis-vertical" size={15} color={theme.colors.gray} label="" />
        </Box>
      </button>
      {open
        ? createPortal(
            <Box
              ref={panelRef}
              nativeID={id}
              role="menu"
              aria-label={label}
              className="asset-review-actions-menu"
              backgroundColor="white"
              borderColor="gray10"
              borderWidth={1}
              borderRadius="m"
              padding="xs"
              gap="xxs"
              style={{ ...position }}
              onKeyDown={(event: React.KeyboardEvent<HTMLElement>) => {
                if (event.key === 'Tab') {
                  setOpen(false);
                  triggerRef.current?.focus({ preventScroll: true });
                  return;
                }
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                event.stopPropagation();
                const choices = [
                  ...(panelRef.current?.querySelectorAll<HTMLButtonElement>(
                    'button:not(:disabled)',
                  ) ?? []),
                ];
                const current = choices.indexOf(document.activeElement as HTMLButtonElement);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? choices.length - 1
                      : (current + (event.key === 'ArrowUp' ? -1 : 1) + choices.length) %
                        choices.length;
                choices[next]?.focus({ preventScroll: true });
              }}
            >
              {items.map((item, index) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  aria-label={item.label}
                  aria-describedby={`${id}-${index}`}
                  disabled={item.disabled}
                  className="asset-review-action-item"
                  onClick={() => {
                    setOpen(false);
                    triggerRef.current?.focus({ preventScroll: true });
                    item.onSelect();
                  }}
                >
                  <Box flexDirection="row" alignItems="center" gap="s">
                    <Box aria-hidden={true} width={16} alignItems="center">
                      <Icon
                        name={item.icon}
                        size={14}
                        color={
                          item.icon === 'ban' || item.icon === 'trash-can'
                            ? theme.colors.danger120
                            : theme.colors.primary120
                        }
                        label=""
                      />
                    </Box>
                    <Text
                      variant="bodySmall"
                      semibold
                      color={
                        item.icon === 'ban' || item.icon === 'trash-can'
                          ? 'danger120'
                          : 'primary120'
                      }
                    >
                      {item.label}
                    </Text>
                  </Box>
                  <Text
                    nativeID={`${id}-${index}`}
                    variant="bodySmall"
                    color="gray"
                    style={{ paddingLeft: theme.spacing.l }}
                  >
                    {item.description}
                  </Text>
                </button>
              ))}
            </Box>,
            document.body,
          )
        : null}
    </>
  );
}
