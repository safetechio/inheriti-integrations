import { Alert, Box, Button, Icon, Pressable, Text, theme } from '@main-components';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';
import { keyboardActivation } from '@modules/_shared/ui/keyboard-activation';
import { hasIncludedSchemaField, type ReviewAsset } from '../types';
export function InspectorActions({
  asset,
  onAction,
  onGoToField,
}: {
  asset: ReviewAsset;
  onGoToField: (fieldKey: string) => void;
  onAction?: (action: string, asset: ReviewAsset) => void;
}) {
  const hasIncludedField = hasIncludedSchemaField(asset);
  const pending = asset.status !== 'accepted' && asset.status !== 'excluded';
  const issue = pending && onAction && !hasIncludedField ? getAcceptanceIssue(asset) : undefined;
  const fieldKey = issue?.fieldKey;
  const goToField = fieldKey ? () => onGoToField(fieldKey) : undefined;
  return (
    <Box gap="s" className="asset-inspector-actions">
      {issue ? (
        <Alert
          tone="warning"
          dismissable={false}
          compact
          action={
            goToField ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go to field"
                onPress={goToField}
                {...keyboardActivation(goToField)}
              >
                <Box flexDirection="row" alignItems="center" gap="xs">
                  <Text
                    variant="buttonSmall"
                    color="warning200"
                    style={{ textDecorationLine: 'underline' }}
                  >
                    Go to field
                  </Text>
                  <Icon name="arrow-right" size={11} color={theme.colors.warning200} label="" />
                </Box>
              </Pressable>
            ) : undefined
          }
        >
          {issue.message}
        </Alert>
      ) : null}
      {pending ? (
        <Box
          className="asset-inspector-decision-actions"
          flexDirection="row"
          alignItems="center"
          gap="s"
        >
          <Button
            title="Accept"
            startIcon={<Icon name="check" size={12} color={theme.colors.white} />}
            disabled={!onAction || !hasIncludedField}
            onPress={() => onAction?.('accept', asset)}
          />
        </Box>
      ) : null}
      {asset.convertedFromType && asset.status !== 'excluded' ? (
        <Button
          title={`Back to suggested ${getAssetTypeDisplayName(asset.convertedFromType)}`}
          variant="outlined"
          size="sm"
          disabled={!onAction}
          onPress={() => onAction?.('restore-suggestion', asset)}
        />
      ) : null}
    </Box>
  );
}

function getAcceptanceIssue(asset: ReviewAsset): { message: string; fieldKey?: string } {
  const fields = asset.schemaFields ?? [];
  const isPlainText = asset.type === 'PLAIN-TEXT';
  const isMissingSource = (field: (typeof fields)[number]) =>
    !isPlainText && field.key.startsWith('secret.') && !field.sourceFieldId;
  const invalid = fields.find(
    (field) =>
      field.validationError &&
      !isMissingSource(field) &&
      !(
        isPlainText &&
        field.key === 'secret.text' &&
        field.validationError === 'Please fill in this field'
      ),
  );
  if (invalid)
    return {
      message: 'Fix the highlighted fields before accepting this asset.',
      fieldKey: invalid.key,
    };
  if (isPlainText)
    return {
      message: 'Enter a Plain Text secret before accepting this asset.',
      fieldKey: 'secret.text',
    };
  const missing = fields.find(
    (field) => isMissingSource(field) && (field.required || field.validationError),
  );
  if (missing)
    return {
      message: `Choose a source for ${missing.label} before accepting this asset.`,
      fieldKey: missing.key,
    };
  const available = fields.find(
    (field) =>
      isMissingSource(field) && field.candidates?.some((candidate) => candidate.length !== 0),
  );
  return {
    message: 'Choose a source for at least one secret field before accepting this asset.',
    fieldKey: available?.key ?? fields.find(isMissingSource)?.key,
  };
}
