import { Box, Button, Icon, Text, theme } from '@main-components';
import type { ChecklistItem } from '../types';
export function ChecklistRows({ items }: { items: ChecklistItem[] }) {
  return (
    <>
      {items.map((item) => (
        <Box
          key={item.label}
          className={`staging-checklist-row ${
            item.error ? 'has-error' : item.complete ? 'is-complete' : 'needs-fix'
          }`}
          flexDirection="row"
          alignItems="center"
          gap="m"
        >
          <Box className="staging-check-mark">
            <Icon
              name={item.complete ? 'check' : 'circle-exclamation'}
              size={12}
              color={
                item.error
                  ? theme.colors.danger120
                  : item.complete
                    ? theme.colors.success120
                    : theme.colors.warning200
              }
            />
          </Box>
          <Box flex={1} gap="xxs">
            <Text variant="importerChecklistLabel">{item.label}</Text>
            <Text variant="importerChecklistDetail" color="gray">
              {item.detail}
            </Text>
            {item.error ? (
              <Text accessibilityRole="alert" variant="importerChecklistDetail" color="danger120">
                {item.error}
              </Text>
            ) : null}
            {item.loading ? (
              <Box
                accessibilityRole="progressbar"
                accessibilityLabel={`${item.label} in progress`}
                height={6}
                backgroundColor="gray10"
                borderRadius="s"
                overflow="hidden"
              >
                <Box
                  height={6}
                  width="35%"
                  backgroundColor="warning"
                  borderRadius="s"
                  className="staging-indeterminate-bar"
                />
              </Box>
            ) : null}
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
                  endIcon={<Icon name="chevron-right" size={10} />}
                  size="sm"
                  variant="outlined"
                  onPress={item.onFix}
                />
              ) : null}
            </Box>
          ) : null}
        </Box>
      ))}
    </>
  );
}
