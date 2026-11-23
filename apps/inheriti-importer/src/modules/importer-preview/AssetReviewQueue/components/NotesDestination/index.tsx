import { Badge, Box, ChoiceGroup, Icon, Text, Tooltip } from '@main-components';
import { useImperativeHandle, useLayoutEffect, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPopover } from '@modules/_shared/ui/hooks/use-anchored-popover';
import { theme } from '@modules/_shared/ui/theme/AppTheme';
import './styles.css';
import type { NoteDestination, ReviewBatchResult } from '../../types';

const assetNotesVisibility = 'Asset notes are visible in plan details without revealing secrets.';

export const noteOptions = [
  {
    value: 'asset-notes',
    label: 'Asset notes',
  },
  {
    value: 'protected',
    label: 'As secret',
    description: 'Included in the protected contents of the plan.',
  },
] as const;

export function NotesDestination({
  scope,
  count,
  destination,
  effectiveDestination,
  hasUnchosen,
  hasMixedDestinations,
  onChange,
  recoveryRef,
}: {
  scope: string;
  recoveryRef?: Ref<() => void>;
  count: number;
  destination: NoteDestination | null;
  effectiveDestination: NoteDestination | null;
  hasUnchosen: boolean;
  hasMixedDestinations: boolean;
  onChange: (destination: NoteDestination) => ReviewBatchResult;
}) {
  const [result, setResult] = useState<ReviewBatchResult>();
  const { open, setOpen, triggerRef, panelRef, position } = useAnchoredPopover({
    closeOnScroll: true,
  });
  useImperativeHandle(recoveryRef, () => () => setOpen(true), [setOpen]);
  const status = hasUnchosen
    ? 'Needs destination'
    : hasMixedDestinations
      ? 'Mixed'
      : effectiveDestination === 'protected'
        ? 'As secret'
        : effectiveDestination === 'asset-notes'
          ? 'Asset notes'
          : 'Per-asset';

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const radio =
      panel?.querySelector<HTMLInputElement>('input[type=radio]:checked:not(:disabled)') ??
      panel?.querySelector<HTMLInputElement>('input[type=radio]:not(:disabled)');
    radio?.focus({ preventScroll: true });
  }, [open, panelRef]);

  const selectDestination = (value: NoteDestination) => setResult(onChange(value));

  return (
    <Box className="importer-review-note-control" flexDirection="row" alignItems="center" gap="xs">
      <button
        ref={triggerRef}
        type="button"
        className="importer-notes-trigger"
        aria-label="Notes destination"
        aria-description={`${scope} · ${count} ${count === 1 ? 'field' : 'fields'} · ${status}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Notes destination · ${scope}`}
        onClick={() => setOpen(!open)}
      >
        <Icon name="note-sticky" type="font-awesome-6" size={14} color="primary" label="" />
        <Text variant="bodySmall" semibold>
          Notes ({count})
        </Text>
        <Badge size="sm" tone={hasUnchosen ? 'warning' : 'neutral'}>
          {status}
        </Badge>
      </button>
      <Box className="importer-notes-help">
        <Tooltip content={assetNotesVisibility}>
          <Icon name="circle-info" size={12} color={theme.colors.gray} label="About Asset notes" />
        </Tooltip>
      </Box>
      {open &&
        createPortal(
          <Box
            ref={panelRef}
            role="dialog"
            aria-label="Choose notes destination"
            gap="s"
            padding="m"
            borderWidth={1}
            borderColor="gray10"
            borderRadius="s"
            backgroundColor="white"
            className="importer-notes-popover"
            style={position}
          >
            <Text variant="bodySmall" color="gray">
              {assetNotesVisibility}
            </Text>
            <ChoiceGroup
              label={`Notes destination · ${scope} · ${count} ${count === 1 ? 'field' : 'fields'}`}
              value={hasUnchosen ? null : destination}
              options={noteOptions}
              onChange={selectDestination}
              onReselect={selectDestination}
              helperText={
                hasUnchosen
                  ? 'Unchosen notes stay protected.'
                  : 'Per-asset choices take precedence. Notes that cannot be saved as Asset notes stay protected.'
              }
            />
            {result?.skippedIds.length ? (
              <Text variant="bodySmall" color="gray" role="status">
                {result.skippedIds.length} {result.skippedIds.length === 1 ? 'note' : 'notes'}{' '}
                skipped. Protected-only notes stay protected.
              </Text>
            ) : null}
          </Box>,
          document.body,
        )}
    </Box>
  );
}
