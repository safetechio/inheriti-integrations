import { Box, Button, Icon } from '@main-components';
import { useTheme } from '@modules/_shared/ui/theme/AppTheme';

type FlowActionsProps = {
  canGoBack: boolean;
  canGoNext: boolean;
  onBack: () => void;
  onNext: () => void;
  showComplete: boolean;
  nextLabel: string;
  isStaging?: boolean;
  canStage?: boolean;
  onStage?: () => void;
  stagingState?: string;
};

export function FlowActions({
  canGoBack,
  canGoNext,
  onBack,
  onNext,
  showComplete,
  nextLabel,
  isStaging = false,
  canStage = false,
  onStage,
  stagingState,
}: FlowActionsProps) {
  const theme = useTheme();

  return (
    <Box
      className="importer-flow-actions"
      flexDirection="row"
      flexWrap="wrap"
      justifyContent="space-between"
      alignItems="center"
      gap={theme.importer.spacing.sectionGap}
    >
      <Button
        title="Back"
        startIcon={
          <Icon
            name="chevron-left"
            size={11}
            color={canGoBack ? theme.colors.primary120 : theme.colors.gray50}
          />
        }
        variant="outlined"
        size="sm"
        minHeight={theme.importer.controls.footerSecondaryHeight}
        paddingHorizontal={theme.importer.spacing.sectionGap}
        textVariant="buttonFooterSecondary"
        disabled={!canGoBack}
        onPress={onBack}
      />
      {showComplete ? (
        <Button
          title={nextLabel}
          minHeight={theme.importer.controls.footerPrimaryHeight}
          paddingHorizontal={theme.importer.spacing.actionPaddingInline}
          textVariant="buttonFooterPrimary"
          disabled={!canGoNext}
          endIcon={<Icon name="chevron-right" size={11} color={theme.colors.white} />}
          onPress={onNext}
        />
      ) : isStaging && !['staged', 'retry', 'failed-stage'].includes(stagingState ?? '') ? (
        <Button
          title={stagingState === 'encrypting' ? 'Staging…' : 'Encrypt and stage'}
          startIcon={<Icon name="shield" size={12} color={theme.colors.white} />}
          minHeight={theme.importer.controls.footerPrimaryHeight}
          paddingHorizontal={theme.importer.spacing.actionPaddingInline}
          textVariant="buttonFooterPrimary"
          loading={stagingState === 'encrypting' || stagingState === 'releasing'}
          disabled={
            !canStage ||
            !onStage ||
            ['waiting-release', 'releasing', 'encrypting', 'staged'].includes(stagingState ?? '')
          }
          onPress={() => onStage?.()}
        />
      ) : null}
    </Box>
  );
}

export default FlowActions;
