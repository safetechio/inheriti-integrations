import { useState } from 'react';
import { BaseModal, Box, Text } from '@modules/_shared/ui/components';
import Button from '@modules/_shared/ui/components/Base/Button';

export type DiscardSummary = { fileCount: number; planCount: number };

/**
 * Owns its own open/close state so toggling the confirm dialog only re-renders
 * this small header slice — not the whole app tree (which App's state would,
 * since `children` gets recreated on every App re-render).
 */
export function DiscardAllControl({
  summary,
  onConfirm,
}: {
  summary: DiscardSummary;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Box>
        <Button
          title="Discard all"
          variant="outlined"
          size="sm"
          color="danger"
          onPress={() => setConfirming(true)}
        />
      </Box>
      <BaseModal
        visible={confirming}
        title="Discard everything?"
        description="This clears every imported file, mapping, and Plan draft in this session. It cannot be undone."
        onDismiss={() => setConfirming(false)}
        footer={
          <>
            <Button title="Cancel" variant="plain" onPress={() => setConfirming(false)} />
            <Button
              title="Discard all"
              color="danger"
              onPress={() => {
                onConfirm();
                setConfirming(false);
              }}
            />
          </>
        }
      >
        <Text variant="bodySmall" color="gray">
          {summary.fileCount} imported file{summary.fileCount === 1 ? '' : 's'} ·{' '}
          {summary.planCount} Plan{summary.planCount === 1 ? '' : 's'} will be removed.
        </Text>
      </BaseModal>
    </>
  );
}
