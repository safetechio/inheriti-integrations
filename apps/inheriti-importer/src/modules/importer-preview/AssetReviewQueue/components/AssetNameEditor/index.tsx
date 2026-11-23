import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Button, Icon, Text, Tooltip } from '@main-components';

export function AssetNameEditor({
  name,
  onRename,
  actions,
  status,
}: {
  name: string;
  actions?: ReactNode;
  status?: ReactNode;
  onRename?: (name: string) => boolean;
}) {
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const pencil = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const finished = useRef(false);
  const errorId = useId();
  const editing = draft !== undefined;
  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus({ preventScroll: true });
      input.current?.select();
    } else if (restoreFocus.current) {
      pencil.current?.focus({ preventScroll: true });
      restoreFocus.current = false;
    }
  }, [editing]);

  const close = (focus = true) => {
    finished.current = true;
    restoreFocus.current = focus;
    setDraft(undefined);
    setError('');
  };
  const save = (blur = false) => {
    if (finished.current) return;
    const next = draft?.trim();
    if (!next) return blur ? close(false) : setError('Enter an asset name.');
    if (next.length > 160)
      return blur ? close(false) : setError('Asset name must be 160 characters or fewer.');
    if (next !== name && !onRename?.(next)) return setError('Could not rename this asset.');
    close(!blur);
  };
  if (!editing) {
    return (
      <Box flexDirection="row" alignItems="center" flexWrap="wrap" gap="s" minWidth={0}>
        <Text
          variant="importerAssetTitle"
          className="asset-inspector-heading-text asset-inspector-title"
        >
          {name}
        </Text>
        <Box
          className="asset-inspector-heading-actions"
          flexDirection="row"
          alignItems="center"
          gap="s"
          style={{ marginLeft: 'auto', flexShrink: 0 }}
        >
          {status}
          <Box
            flexDirection="row"
            alignItems="center"
            gap="xxs"
            backgroundColor="gray5"
            borderWidth={1}
            borderColor="gray10"
            borderRadius="s"
            padding="xxs"
          >
            {onRename ? (
              <Tooltip content="Edit asset name">
                <button
                  ref={pencil}
                  type="button"
                  className="asset-review-actions-trigger"
                  aria-label="Edit asset name"
                  onClick={() => {
                    finished.current = false;
                    setDraft(name);
                  }}
                >
                  <Icon name="pen" type="font-awesome-6" size={13} color="gray" label="" />
                </button>
              </Tooltip>
            ) : null}
            {actions}
          </Box>
        </Box>
      </Box>
    );
  }
  return (
    <Box flexDirection="row" alignItems="flex-start" flexWrap="wrap" gap="s">
      <Box
        gap="xs"
        style={{ flex: 1, minWidth: 180 }}
        onBlur={(event: React.FocusEvent<HTMLElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget)) save(true);
        }}
        onMouseDown={(event: React.MouseEvent<HTMLElement>) => {
          if (event.target instanceof Element && event.target.closest('button'))
            event.preventDefault();
        }}
      >
        <Box flexDirection="row" alignItems="center" flexWrap="wrap" gap="xs">
          <input
            className="asset-type-select"
            ref={input}
            aria-label="Asset name"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            value={draft}
            style={{ flex: 1, minWidth: 140 }}
            onChange={(event) => {
              setDraft(event.target.value);
              setError('');
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key !== 'Enter' && event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              if (event.key === 'Enter') save();
              else close();
            }}
          />
          <Button
            title="Save"
            accessibilityLabel="Save asset name"
            size="sm"
            onPress={() => save()}
          />
          <Button
            title="Cancel"
            accessibilityLabel="Cancel asset name edit"
            size="sm"
            variant="plain"
            onPress={() => close()}
          />
        </Box>
        {error ? (
          <Text nativeID={errorId} role="alert" color="danger120" variant="xSmall">
            {error}
          </Text>
        ) : null}
      </Box>
      {status}
    </Box>
  );
}
