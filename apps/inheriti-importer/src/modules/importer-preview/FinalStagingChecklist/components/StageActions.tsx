import { Box, Button, Icon, theme } from '@main-components';
export function StageActions({
  failed,
  canStage,
  state,
  onStage,
  onRetry,
}: {
  failed: boolean;
  canStage: boolean;
  state: string;
  onStage?: () => void;
  onRetry?: () => void;
}) {
  return (
    <Box flexDirection="row" justifyContent="flex-end" gap="s">
      {failed ? (
        <Button
          title="Retry staging"
          startIcon={<Icon name="rotate" size={12} color={theme.colors.primary120} />}
          variant="outlined"
          onPress={() => onRetry?.()}
          disabled={!canStage || !onRetry}
        />
      ) : null}
      {!failed && state !== 'staged' ? (
        <Button
          title={state === 'encrypting' ? 'Staging…' : 'Encrypt and stage'}
          startIcon={<Icon name="shield" size={12} color={theme.colors.white} />}
          onPress={() => onStage?.()}
          disabled={
            !canStage ||
            !onStage ||
            state === 'waiting-release' ||
            state === 'releasing' ||
            state === 'encrypting'
          }
        />
      ) : null}
    </Box>
  );
}
