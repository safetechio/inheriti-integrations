import { useState } from 'react';
import { Badge, BaseModal, Box, Button, Text } from '@main-components';
import { getAssetFieldDisplayName } from '@modules/_shared/domain/asset-field-display-name';
import { keyboardActivation } from '@modules/_shared/ui/keyboard-activation';
import type { SourceCoverage } from '@modules/mapping/application/source-coverage';
import type { ReviewAsset } from '../../types';
import { statusBadge, statusLabel } from '../status';

export function AssetReviewDetails({
  asset,
  coverage,
  sourceFields,
}: {
  asset: ReviewAsset;
  coverage?: SourceCoverage;
  sourceFields: SourceCoverage['fields'];
}) {
  const [open, setOpen] = useState(false);
  const showDetails = () => setOpen(true);
  const dismiss = () => setOpen(false);
  const fields = open ? sourceFields : [];
  const diagnostics =
    open && asset.sourceId && asset.sourceNodeId
      ? coverage?.diagnostics.filter(
          (diagnostic) =>
            diagnostic.sourceId === asset.sourceId && diagnostic.entryId === asset.sourceNodeId,
        )
      : undefined;
  const showReviewReasons = open && asset.status !== 'excluded';
  const reviewReasons = showReviewReasons
    ? (asset.schemaFields ?? []).flatMap((field) => {
        if (field.validationError) return [`${field.label} — ${field.validationError}`];
        const hasPlainText =
          field.key === 'secret.text' &&
          (asset.plainTextValue?.length || asset.plainTextSources?.length);
        if (field.required && !field.sourceFieldId && !hasPlainText)
          return [`${field.label} — Required field is missing.`];
        return [];
      })
    : [];
  if (showReviewReasons && asset.type !== 'PLAIN-TEXT') {
    const protectedFields = asset.schemaFields?.filter(({ key }) => key.startsWith('secret.'));
    if (protectedFields?.length && !protectedFields.some(({ sourceFieldId }) => sourceFieldId))
      reviewReasons.push('Map at least one protected field before accepting this asset.');
  }
  const note = asset.note;
  const notesPending =
    showReviewReasons &&
    note &&
    !note.explicit &&
    !fields.some(({ id, status }) => id === note.sourceFieldId && status === 'excluded');

  return (
    <Box
      flexDirection="row"
      alignItems="center"
      justifyContent="flex-end"
      flexWrap="wrap"
      gap="xs"
      className="asset-review-details-actions"
    >
      {asset.status !== 'suggested' ? (
        <Badge
          tone={statusBadge[asset.status].tone}
          className="asset-review-details-badge"
          accessibilityRole="button"
          aria-haspopup="dialog"
          onClick={showDetails}
          {...keyboardActivation(showDetails)}
        >
          {statusLabel[asset.status]}
        </Badge>
      ) : null}
      <Button
        title="Details"
        accessibilityLabel="View asset review details"
        variant="plain"
        size="sm"
        minHeight={24}
        onPress={showDetails}
      />
      <BaseModal
        visible={open}
        title={`${asset.name} — Review details`}
        onDismiss={dismiss}
        footer={<Button title="Done" variant="outlined" onPress={dismiss} />}
      >
        <Box gap="m" className="asset-review-details-content">
          <Box gap="xs">
            <Text variant="bodySmall" color="gray">
              {[asset.sourceFileName || asset.source, ...(asset.folderPath ?? [])].join(' · ')}
            </Text>
            <Text variant="bodyRegular" semibold>
              {statusLabel[asset.status]}
            </Text>
            {asset.rationale ? <Text variant="bodySmall">{asset.rationale}</Text> : null}
            {reviewReasons.map((reason, index) => (
              <Text key={index} variant="bodySmall" color="danger120">
                {reason}
              </Text>
            ))}
            {asset.status === 'needs-review' && !reviewReasons.length && !notesPending ? (
              <Text variant="bodySmall">
                Review the detected type and mapped fields before accepting.
              </Text>
            ) : null}
            {notesPending ? (
              <Text variant="bodySmall">
                Choose a destination for the imported notes. They remain protected while you decide.
              </Text>
            ) : null}
            {notesPending && note.reason ? (
              <Text variant="bodySmall" color="gray">
                {note.reason}
              </Text>
            ) : null}
          </Box>
          <Box gap="s">
            <Text variant="bodySmall" semibold accessibilityRole="heading">
              Source field coverage
            </Text>
            {fields.map((field) => (
              <Box key={field.id} gap="xxs">
                <Text variant="bodySmall" semibold>
                  {field.name}
                </Text>
                {describeField(field, asset.id).map((description) => (
                  <Text key={description} variant="bodySmall" color="gray">
                    {description}
                  </Text>
                ))}
              </Box>
            ))}
            {!coverage ? (
              <>
                {asset.mapped.map((name, index) => (
                  <Text key={`mapped:${index}`} variant="bodySmall">
                    {name} — Mapped to this asset
                  </Text>
                ))}
                {asset.unmapped.map((name, index) => (
                  <Text key={`unmapped:${index}`} variant="bodySmall">
                    {name} — Unmapped
                  </Text>
                ))}
              </>
            ) : null}
            {!fields.length && (coverage || (!asset.mapped.length && !asset.unmapped.length)) ? (
              <Text variant="bodySmall" color="gray">
                No source field coverage for this asset.
              </Text>
            ) : null}
          </Box>
          {diagnostics?.length ? (
            <Box gap="xs">
              <Text variant="bodySmall" semibold accessibilityRole="heading">
                Import warnings
              </Text>
              {diagnostics.map(({ message, count }, index) => (
                <Text key={index} variant="bodySmall" color="gray">
                  {message}
                  {count > 1 ? ` (${count})` : ''}
                </Text>
              ))}
            </Box>
          ) : null}
        </Box>
      </BaseModal>
    </Box>
  );
}

function describeField(field: SourceCoverage['fields'][number], assetId: string): string[] {
  if (field.status === 'excluded') return ['Explicitly excluded from import'];
  if (field.status === 'pending') return ['Pending a destination'];
  if (field.status === 'invalid') return ['Invalid destination — review required'];
  return [
    ...new Set(
      field.destinations.map((destination) => {
        if (destination.valid === false) {
          const asset = destination.assetId === assetId ? 'This asset' : 'Additional asset';
          return `Invalid destination · ${asset} · ${getAssetFieldDisplayName(destination.fieldId)}`;
        }
        const preservation =
          field.status === 'protected' && destination.fieldId === 'secret.text'
            ? 'Protected text'
            : 'Mapped';
        if (destination.assetId !== assetId)
          return `Preserved in an additional asset · ${preservation}`;
        return `${preservation} · This asset · ${getAssetFieldDisplayName(destination.fieldId)}`;
      }),
    ),
  ];
}
