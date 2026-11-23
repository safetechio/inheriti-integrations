import { Box, Button, Icon, Text, Tooltip } from '@main-components';
import type { FieldOperationRequest } from '../../field-operations';
import './styles.css';

const actions = [
  {
    action: 'create',
    label: 'Create assets',
    icon: 'plus',
    hint: 'Review suggested assets, group as Plain Text, or split selected fields across assets',
  },
  {
    action: 'move',
    label: 'Assign to asset',
    icon: 'arrow-right-arrow-left',
    hint: 'Assign selected fields to an existing asset in the same entry',
  },
] as const;

export function FieldSelectionActions({
  count,
  canMove,
  canOrganize = true,
  organizeUnavailable,
  canExclude,
  moveUnavailable = 'No compatible asset from this entry',
  onClear,
  onStart,
  onExclude,
}: {
  count: number;
  canMove: boolean;
  canOrganize?: boolean;
  organizeUnavailable?: string;
  canExclude: boolean;
  moveUnavailable?: string;
  onClear: () => void;
  onStart?: (action: FieldOperationRequest['action']) => void;
  onExclude?: () => void;
}) {
  return (
    <Box flex={1} gap="xs">
      <Box flexDirection="row" alignItems="center" gap="xs">
        <Text variant="bodySmall" semibold role="status">
          {count} selected
        </Text>
        <Button title="Clear" size="sm" variant="plain" disabled={!count} onPress={onClear} />
      </Box>
      <Box gap="xs" className="asset-issue-actions">
        {onStart
          ? actions.map(({ action, label, hint, icon }) => (
              <Tooltip
                key={action}
                content={
                  !canOrganize
                    ? organizeUnavailable
                    : action === 'move' && !canMove
                      ? moveUnavailable
                      : hint
                }
              >
                <Button
                  title={label}
                  size="sm"
                  block
                  variant={action === 'create' ? 'contained' : 'outlined'}
                  color={action === 'move' ? 'gray' : 'primary'}
                  startIcon={
                    <Icon
                      name={icon}
                      type="font-awesome-6"
                      size={13}
                      color={action === 'create' ? 'white' : 'gray'}
                      label=""
                    />
                  }
                  disabled={!count || !canOrganize || (action === 'move' && !canMove)}
                  onPress={() => onStart(action)}
                />
              </Tooltip>
            ))
          : null}
        {onExclude ? (
          <Tooltip content="Leave selected unresolved fields out of the staged plans">
            <Button
              title="Exclude fields"
              size="sm"
              variant="outlined"
              color="danger"
              block
              startIcon={
                <Icon name="ban" type="font-awesome-6" size={13} color="danger" label="" />
              }
              disabled={!canExclude}
              onPress={onExclude}
            />
          </Tooltip>
        ) : null}
      </Box>
    </Box>
  );
}
