import type { ReactNode } from 'react';
import { Box, Button, Icon, Text, theme } from '@main-components';
import type { ChecklistItem } from '../types';
export function ChecklistRows({
  items,
  secureAction,
  secureHeaderAction,
  planProgress = false,
}: {
  items: ChecklistItem[];
  secureAction?: ReactNode;
  secureHeaderAction?: ReactNode;
  planProgress?: boolean;
}) {
  const titleTypography = theme.textVariants.importerChecklistLabel;
  const markOffset = (titleTypography.fontSize * titleTypography.lineHeight - 24) / 2;
  return (
    <>
      {items.map((item) => (
        <Box
          key={item.label}
          className={`staging-checklist-row ${
            item.error ? 'has-error' : item.complete ? 'is-complete' : 'needs-fix'
          } ${item.label === 'Secure staging' && planProgress ? 'is-staging' : ''}`}
          flexDirection="row"
          alignItems={item.label === 'Secure staging' && planProgress ? 'flex-start' : 'center'}
          gap="m"
        >
          <Box
            className="staging-check-mark"
            alignSelf="flex-start"
            style={{ marginTop: markOffset }}
          >
            <Icon
              name={
                item.complete
                  ? 'check'
                  : item.loading
                    ? 'spinner'
                    : item.label === 'Secure staging'
                      ? 'hourglass'
                      : 'spinner'
              }
              size={item.loading && planProgress ? 20 : item.complete ? 14 : 12}
              spin={Boolean(item.loading)}
              color={
                item.error
                  ? theme.colors.danger120
                  : item.complete
                    ? theme.colors.success120
                    : item.loading
                      ? theme.colors.primary
                      : theme.colors.gray50
              }
            />
          </Box>
          <Box flex={1} gap="xxs">
            <Box
              flexDirection="row"
              justifyContent="space-between"
              alignItems={planProgress ? 'flex-start' : 'center'}
              gap="m"
            >
              <Box flex={1} gap="xxs">
                <Text variant="importerChecklistLabel">{item.label}</Text>
                <Text variant="importerChecklistDetail" color="gray">
                  {item.detail}
                </Text>
                {item.error ? (
                  <Text
                    accessibilityRole="alert"
                    variant="importerChecklistDetail"
                    color="danger120"
                  >
                    {item.error}
                  </Text>
                ) : null}
              </Box>
              {item.label === 'Secure staging' ? secureHeaderAction : null}
            </Box>
            {item.label === 'Secure staging' ? secureAction : null}
          </Box>
          {!item.complete && (item.onFix || item.onSecondaryFix) ? (
            <Box flexDirection="row" alignItems="center" gap="s">
              {item.onSecondaryFix ? (
                <Button
                  title={item.secondaryFixLabel ?? 'Alternative'}
                  size="sm"
                  variant="plain"
                  onPress={item.onSecondaryFix}
                />
              ) : null}
              {item.onFix ? (
                <Button
                  title={item.fixLabel ?? 'Review'}
                  endIcon={
                    item.fixLabel === 'Cancel request' ? undefined : (
                      <Icon name="chevron-right" size={10} />
                    )
                  }
                  size="sm"
                  variant={item.fixLabel === 'Cancel request' ? 'plain' : 'outlined'}
                  color={item.fixLabel === 'Cancel request' ? 'gray' : undefined}
                  onPress={item.onFix}
                  disabled={item.fixDisabled}
                />
              ) : null}
            </Box>
          ) : null}
        </Box>
      ))}
    </>
  );
}
