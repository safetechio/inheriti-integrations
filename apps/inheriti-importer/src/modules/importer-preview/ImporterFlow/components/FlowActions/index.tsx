import { Box, Button, Icon, Pressable, Text } from '@main-components';
import { keyboardActivation } from '@modules/_shared/ui/keyboard-activation';
import { useTheme } from '@modules/_shared/ui/theme/AppTheme';
import './styles.css';

type FlowActionsProps = {
  canGoBack: boolean;
  canGoNext: boolean;
  onBack: () => void;
  onNext: () => void;
  showComplete: boolean;
  nextLabel: string;
  summary?: string;
  recovery?: { label: string; onPress: () => void };
};

export function FlowActions({
  canGoBack,
  canGoNext,
  onBack,
  onNext,
  showComplete,
  nextLabel,
  summary,
  recovery,
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
            color={canGoBack ? theme.colors.gray : theme.colors.gray50}
          />
        }
        variant="outlined"
        color="gray"
        size="sm"
        minHeight={theme.importer.controls.footerSecondaryHeight}
        paddingHorizontal={theme.importer.spacing.sectionGap}
        textVariant="buttonFooterSecondary"
        disabled={!canGoBack}
        onPress={onBack}
      />
      {summary && recovery ? (
        <Box
          className="importer-flow-recovery"
          flexDirection="row"
          flexWrap="wrap"
          alignItems="center"
          gap="xs"
          style={{ marginLeft: 'auto' }}
        >
          <Text variant="importerFooterNote" color="gray" accessibilityLiveRegion="polite">
            {summary}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={recovery.label}
            onPress={recovery.onPress}
            {...keyboardActivation(recovery.onPress)}
          >
            <Box flexDirection="row" alignItems="center" gap="xxs">
              <Text
                variant="buttonSmall"
                color="primary"
                style={{ textDecorationLine: 'underline' }}
              >
                {recovery.label}
              </Text>
              <Icon name="arrow-right" size={11} color={theme.colors.primary} label="" />
            </Box>
          </Pressable>
        </Box>
      ) : summary ? (
        <Text variant="importerFooterNote" color="gray" style={{ marginLeft: 'auto' }}>
          {summary}
        </Text>
      ) : null}
      {showComplete ? (
        <Button
          title={nextLabel}
          minHeight={theme.importer.controls.footerPrimaryHeight}
          paddingHorizontal={theme.importer.spacing.actionPaddingInline}
          textVariant="buttonFooterPrimary"
          disabled={!canGoNext}
          endIcon={
            <Box
              className={
                canGoNext && nextLabel === 'Continue' ? 'importer-continue-arrow' : undefined
              }
            >
              <Icon name="chevron-right" size={11} color={theme.colors.white} />
            </Box>
          }
          onPress={onNext}
        />
      ) : null}
    </Box>
  );
}

export default FlowActions;
