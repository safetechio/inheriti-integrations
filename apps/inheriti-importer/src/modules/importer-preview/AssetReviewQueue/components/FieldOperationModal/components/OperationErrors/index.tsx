import { useState } from 'react';
import { Box, Button, Icon, Text } from '@main-components';

export function OperationErrors({
  errors,
  entryNames,
}: {
  errors: string[];
  entryNames: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const grouped = new Map<string, Set<string>>();
  for (const error of new Set(errors)) {
    const name = entryNames.find((name) => error.startsWith(`${name}: `));
    const message = name ? error.slice(name.length + 2) : error;
    const names = grouped.get(message) ?? new Set<string>();
    if (name) names.add(name);
    grouped.set(message, names);
  }
  if (!grouped.size) return null;
  return (
    <Box
      gap="s"
      padding="s"
      borderWidth={1}
      borderColor="danger10"
      backgroundColor="danger5"
      borderRadius="s"
      role="alert"
    >
      <Box flexDirection="row" alignItems="center" gap="s">
        <Icon name="circle-exclamation" color="danger120" size={16} label="" />
        <Text variant="bodySmall" semibold color="danger120">
          Review the selected fields
        </Text>
      </Box>
      {[...grouped].map(([message, names]) => (
        <Box key={message} gap="xs">
          <Text variant="bodySmall" color="danger120">
            {message}
          </Text>
          {names.size ? (
            <>
              <Button
                title={`${expanded ? 'Hide' : 'Show'} ${names.size} affected ${names.size === 1 ? 'entry' : 'entries'}`}
                size="sm"
                variant="plain"
                onPress={() => setExpanded(!expanded)}
              />
              {expanded ? (
                <Text variant="bodySmall" color="gray">
                  {[...names].join(' · ')}
                </Text>
              ) : null}
            </>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}
