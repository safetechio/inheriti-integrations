import { useState } from 'react';
import { Box, Button, Text, Tooltip } from '@main-components';
import type { SourceCoverageField } from '@modules/mapping/application/source-coverage';
import type { ReviewAsset } from '../../types';
import type { ImportReviewControls } from '../../import-review-controls';
import {
  assetSourceFieldRows,
  describeField,
  sourceFieldDisplayName,
} from '../../source-field-coverage';

const previewSize = 6;

export function AssetSourceFields({
  asset,
  fields,
  onPreserveFields,
}: {
  asset: ReviewAsset;
  fields: SourceCoverageField[];
  onPreserveFields?: ImportReviewControls['onPreserveFields'];
}) {
  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState<string>();
  const rows = assetSourceFieldRows(asset, fields);
  const pending = rows.filter((row) => row.pending);
  const actionable = pending.filter((row) => row.actionable);
  const mappedHere = rows.filter((row) => row.mappedHere).length;
  const coveredElsewhere = rows.filter((row) => row.coveredElsewhere).length;
  const proposedHere = rows.filter((row) => row.proposed.some(({ invalid }) => !invalid)).length;
  const excluded = fields.filter((field) => field.status === 'excluded').length;
  const summary = [
    mappedHere && `${mappedHere} mapped here`,
    coveredElsewhere && `${coveredElsewhere} in additional assets`,
    pending.length && `${pending.length} pending`,
    proposedHere && `${proposedHere} proposed`,
    excluded && `${excluded} excluded`,
  ]
    .filter(Boolean)
    .join(' · ');
  const orderedFields = [...pending, ...rows.filter((row) => !row.pending)];
  const visibleFields = expanded ? orderedFields : orderedFields.slice(0, previewSize);
  const include = (ids: string[]) => {
    if (!onPreserveFields) return;
    const { changedIds, skippedIds } = onPreserveFields(ids);
    setResult(`${changedIds.length} included in protected text · ${skippedIds.length} skipped`);
  };

  return (
    <Box
      role="region"
      aria-label="Source fields"
      gap="xs"
      padding="s"
      borderWidth={1}
      borderColor="gray10"
      borderRadius="s"
    >
      <Box
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        flexWrap="wrap"
        gap="xs"
      >
        <Text variant="bodySmall" semibold accessibilityRole="heading">
          Source fields
        </Text>
        {onPreserveFields && actionable.length > 1 ? (
          <Button
            title="Include all unmapped fields"
            variant="outlined"
            size="sm"
            onPress={() => include(actionable.map(({ field }) => field.id))}
          />
        ) : null}
      </Box>
      {summary ? (
        <Text variant="bodySmall" color="gray">
          {summary}
        </Text>
      ) : null}
      {actionable.length > 0 && onPreserveFields ? (
        <Text variant="bodySmall" color="gray">
          Unmapped fields can be kept in an additional protected Plain Text asset.
        </Text>
      ) : null}
      {visibleFields.map((row) => (
        <Box
          key={row.field.id}
          flexDirection="row"
          alignItems="flex-start"
          gap="xs"
          paddingTop="xxs"
          borderTopWidth={1}
          borderColor="gray10"
        >
          <Box flex={1} minWidth={0}>
            <Text variant="bodySmall" semibold className="asset-source-field-label">
              {sourceFieldDisplayName(row.field.name)}
            </Text>
            {describeField(row, asset).map((description) => (
              <Text
                key={description}
                variant="bodySmall"
                color="gray"
                className="asset-source-field-label"
              >
                {description}
              </Text>
            ))}
          </Box>
          {onPreserveFields && row.actionable ? (
            <Tooltip content="Include in protected text">
              <Button
                title="Include"
                accessibilityLabel={`Include in protected text: ${sourceFieldDisplayName(row.field.name)}`}
                variant="outlined"
                size="sm"
                minHeight={24}
                paddingHorizontal="xs"
                onPress={() => include([row.field.id])}
              />
            </Tooltip>
          ) : null}
        </Box>
      ))}
      {fields.length > previewSize ? (
        <Button
          title={expanded ? 'Show fewer fields' : `Show all ${fields.length} fields`}
          variant="plain"
          size="sm"
          onPress={() => setExpanded(!expanded)}
        />
      ) : null}
      {result ? (
        <Text variant="bodySmall" role="status">
          {result}
        </Text>
      ) : null}
    </Box>
  );
}
