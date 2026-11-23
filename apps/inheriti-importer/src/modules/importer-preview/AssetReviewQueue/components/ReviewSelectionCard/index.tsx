import { useEffect, useRef, useState } from 'react';
import { Box, Button, Card, Text, Tooltip } from '@main-components';
import type { ReviewBatchAction, ReviewBatchResult } from '../../types';

export type ReviewResult = ReviewBatchResult & { label: string };

export function ReviewSelectionCard({
  count,
  reviewActions,
  result,
  mapping,
  onReview,
  onClear,
  onUndo,
  removal,
}: {
  count: number;
  reviewActions: Record<ReviewBatchAction, boolean>;
  removal?: { canRemove: boolean; onRemove: () => void };
  result?: ReviewResult;
  mapping?: {
    template: string;
    templateId: string;
    compatibleCount: number;
    onApply: () => void;
  };
  onReview: (action: ReviewBatchAction) => void;
  onClear: () => void;
  onUndo?: () => void;
}) {
  const [confirmTemplateId, setConfirmTemplateId] = useState<string>();
  const cardRef = useRef<HTMLElement | null>(null);
  const popupRef = useRef<HTMLElement | null>(null);
  const canApplyMapping = Boolean(mapping && mapping.compatibleCount > 0);
  const confirming = canApplyMapping && confirmTemplateId === mapping?.templateId;
  useEffect(() => setConfirmTemplateId(undefined), [mapping?.templateId, count]);
  useEffect(() => {
    if (!confirming) return;
    const previousFocus = document.activeElement;
    popupRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setConfirmTemplateId(undefined);
      } else if (['a', 'x'].includes(event.key.toLowerCase())) {
        event.stopPropagation();
      }
    };
    const closeOnOutside = (event: MouseEvent) => {
      if (!cardRef.current?.contains(event.target as Node)) setConfirmTemplateId(undefined);
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', closeOnOutside);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
      document.removeEventListener('mousedown', closeOnOutside);
    };
  }, [confirming]);
  if (!count && !result && !onUndo) return null;
  return (
    <Card ref={cardRef} className="asset-review-selection">
      {count ? (
        <Box
          className="asset-review-selection-actions"
          flexDirection="row"
          alignItems="center"
          gap="s"
          flexWrap="wrap"
        >
          <Text variant="bodySmall" semibold>
            {count} selected
          </Text>
          {reviewActions.accept ? (
            <Tooltip content="Accept eligible selected assets for import. Invalid assets are skipped.">
              <Button
                title="Accept selected"
                size="sm"
                onPress={() => {
                  setConfirmTemplateId(undefined);
                  onReview('accept');
                }}
              />
            </Tooltip>
          ) : null}
          {reviewActions.exclude ? (
            <Tooltip content="Selected assets will not be imported. You can recover them from Excluded.">
              <Button
                title="Exclude selected"
                size="sm"
                color="danger"
                variant="outlined"
                onPress={() => {
                  setConfirmTemplateId(undefined);
                  onReview('exclude');
                }}
              />
            </Tooltip>
          ) : null}
          {reviewActions.restore ? (
            <Tooltip content="Return selected excluded assets to To review with their field choices.">
              <Button
                title="Restore selected"
                size="sm"
                onPress={() => {
                  setConfirmTemplateId(undefined);
                  onReview('restore');
                }}
              />
            </Tooltip>
          ) : null}
          {mapping && canApplyMapping ? (
            <Tooltip content="Reuse the open asset’s field choices. Each entry keeps its own values and manual mappings.">
              <Button
                title="Apply this mapping…"
                size="sm"
                variant="outlined"
                onPress={() => setConfirmTemplateId(confirming ? undefined : mapping.templateId)}
              />
            </Tooltip>
          ) : null}
          {removal?.canRemove ? (
            <Tooltip content="Remove these drafts. Fields without another destination return to Unassigned. You can undo this.">
              <Button
                title={count === 1 ? 'Remove draft asset' : 'Remove draft assets'}
                size="sm"
                color="danger"
                variant="plain"
                onPress={removal.onRemove}
              />
            </Tooltip>
          ) : null}
          <Tooltip content="Deselect all assets. Review decisions are kept.">
            <Button
              title="Clear"
              size="sm"
              variant="plain"
              onPress={() => {
                setConfirmTemplateId(undefined);
                onClear();
              }}
            />
          </Tooltip>
        </Box>
      ) : null}
      {mapping && confirming ? (
        <Box
          ref={popupRef}
          tabIndex={-1}
          className="selection-help-popover asset-review-mapping-popover"
          role="group"
          aria-label="Confirm applying mappings"
        >
          <Text variant="bodySmall" className="asset-review-mapping-summary">
            <Text semibold>{mapping.template}</Text> · {mapping.compatibleCount} of {count} selected
            assets will change
          </Text>
          <Text variant="bodySmall" color="gray">
            Copies field choices. Each asset keeps its values and manual mappings.
          </Text>
          <Box flexDirection="row" gap="s" flexWrap="wrap">
            <Tooltip content="Apply the template to compatible selected assets for review. Manual mappings are kept.">
              <Button
                title="Confirm apply"
                size="sm"
                disabled={!mapping.compatibleCount}
                onPress={() => {
                  setConfirmTemplateId(undefined);
                  mapping.onApply();
                }}
              />
            </Tooltip>
            <Tooltip content="Close the mapping preview and keep the current mappings.">
              <Button
                title="Cancel"
                size="sm"
                variant="plain"
                onPress={() => setConfirmTemplateId(undefined)}
              />
            </Tooltip>
          </Box>
        </Box>
      ) : null}
      {result || onUndo ? (
        <Box flexDirection="row" alignItems="center" gap="s" flexWrap="wrap" role="status">
          {result ? (
            <Text variant="bodySmall">
              {result.changedIds.length} {result.label} · {result.skippedIds.length} skipped
            </Text>
          ) : null}
          {onUndo ? (
            <Tooltip content="Undo the last batch action while keeping later edits.">
              <Button
                title={result ? 'Undo' : 'Undo last batch'}
                size="sm"
                variant="outlined"
                onPress={onUndo}
              />
            </Tooltip>
          ) : null}
        </Box>
      ) : null}
    </Card>
  );
}
