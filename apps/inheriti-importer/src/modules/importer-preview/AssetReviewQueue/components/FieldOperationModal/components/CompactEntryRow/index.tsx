import type { KeyboardEvent, MouseEvent, Ref } from 'react';
import { Badge, Box, Checkbox, Icon, Text, theme } from '@main-components';
import { keyboardActivation } from '@modules/_shared/ui/keyboard-activation';
import { getPlanAssetIconName } from '@modules/plans/domain/asset-metadata';
import './styles.css';

const statusTones = {
  Ready: 'success',
  'Needs fields': 'warning',
  'Review fields': 'danger',
  'Not checked': 'neutral',
} as const;

export function CompactEntryRow({
  entryId,
  name,
  type,
  typeLabel,
  fieldSummary,
  status,
  error,
  expanded,
  selected,
  onEdit,
  onSelect,
  onNavigate,
  rowRef,
}: {
  entryId?: string;
  name: string;
  type?: string;
  typeLabel: string;
  fieldSummary: string;
  status: keyof typeof statusTones;
  error?: string;
  expanded: boolean;
  selected: boolean;
  onEdit: () => void;
  onSelect: (range: boolean) => void;
  onNavigate: (event: KeyboardEvent<HTMLElement>) => void;
  rowRef: Ref<HTMLElement>;
}) {
  const activation = keyboardActivation(onEdit);
  const iconName = getPlanAssetIconName(type);
  return (
    <Box
      dataSet={{ fieldOperationEntryId: entryId }}
      flexDirection="row"
      alignItems="center"
      gap="s"
      padding="s"
      borderWidth={1}
      borderRadius="s"
      borderColor={selected ? 'primary30' : 'gray10'}
      backgroundColor={selected ? 'primary4' : 'white'}
      onClick={(event: MouseEvent<HTMLElement>) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey) onSelect(event.shiftKey);
      }}
    >
      <Checkbox
        aria-label={`Select ${name} for layout`}
        checked={selected}
        readOnly
        onClick={(event) => {
          event.stopPropagation();
          onSelect(event.shiftKey);
        }}
      />
      <Box
        {...activation}
        ref={rowRef}
        className="field-operation-entry-row"
        dataSet={{ marqueeRowControl: '' }}
        role="button"
        aria-label={`${expanded ? 'Collapse' : 'Edit'} ${name}`}
        aria-expanded={expanded}
        flex={1}
        minWidth={0}
        flexDirection="row"
        flexWrap="wrap"
        alignItems="center"
        justifyContent="space-between"
        gap="s"
        onClick={(event: MouseEvent<HTMLElement>) => {
          if (!event.ctrlKey && !event.metaKey && !event.shiftKey) onEdit();
        }}
        onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
          if (event.shiftKey && event.key === ' ') {
            event.preventDefault();
            onSelect(true);
            return;
          }
          onNavigate(event);
          if (!event.defaultPrevented) activation.onKeyDown(event);
        }}
      >
        <Box flex={1} minWidth={0} gap="xxs">
          <Text variant="bodySmall" semibold>
            {name}
          </Text>
          <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap="xs">
            <Box
              flexDirection="row"
              alignItems="center"
              gap="xxs"
              paddingHorizontal="xs"
              borderWidth={1}
              borderColor="gray10"
              borderRadius="sm"
              backgroundColor="gray5"
            >
              {iconName ? <Icon name={iconName} size={12} color={theme.colors.gray} /> : null}
              <Text variant="smallUppercase" color="gray">
                {typeLabel}
              </Text>
            </Box>
            <Text variant="bodySmall" color="gray">
              {fieldSummary}
            </Text>
            <Badge tone={statusTones[status]} size="sm">
              {status}
            </Badge>
          </Box>
          {error ? (
            <Text variant="bodySmall" color="danger120">
              {error}
            </Text>
          ) : null}
        </Box>
        <Text variant="bodySmall" color="primary120" semibold>
          {expanded ? 'Collapse' : 'Edit'}
        </Text>
      </Box>
    </Box>
  );
}
