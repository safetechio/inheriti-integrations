import { useEffect, type RefObject } from 'react';
import { Box, Icon, Text, theme } from '@main-components';
import type { GuideGestureKind } from '../../content';

export function GuideGesture({
  kind,
  surface,
}: {
  kind: GuideGestureKind;
  surface: RefObject<HTMLElement | null>;
}) {
  useEffect(() => {
    const node = surface.current;
    if (!node) return;
    const measure = () => {
      const bounds = node.getBoundingClientRect();
      const center = (selector: string) => {
        const rect = node.querySelector(selector)?.getBoundingClientRect();
        return rect
          ? { x: rect.x - bounds.x + rect.width / 2, y: rect.y - bounds.y + rect.height / 2 }
          : { x: 0, y: 0 };
      };
      const first = center(
        kind === 'assign' || kind === 'new-plan'
          ? '.quick-guide-frame:first-child .quick-guide-pane:first-child .quick-guide-row'
          : '.quick-guide-frame:first-child .quick-guide-demo-control',
      );
      let second = center('.quick-guide-frame:nth-child(2) .quick-guide-demo-control');
      const source = center(
        kind === 'assign'
          ? '.quick-guide-frame:nth-child(2) .quick-guide-pane:first-child .quick-guide-row:last-child'
          : '.quick-guide-frame:nth-child(2) .quick-guide-pane:first-child .quick-guide-row',
      );
      const target = center('.quick-guide-frame:nth-child(3) .quick-guide-pane:last-child');
      const pane = node.querySelector('.quick-guide-pane:last-child')?.getBoundingClientRect();
      const menu = { x: pane ? pane.x - bounds.x + 8 : 0, y: pane ? pane.y - bounds.y + 44 : 0 };
      if (kind === 'mapping') second = center('.quick-guide-demo-choice');
      if (kind === 'undo') second = { x: menu.x + 52, y: menu.y + 52 };
      if (kind === 'assign') second = source;
      if (kind === 'folders')
        second = center('.quick-guide-frame:nth-child(2) .quick-guide-demo-control');
      if (kind === 'group') second = first;
      if (kind === 'new-plan')
        second = center('.quick-guide-frame:nth-child(2) .quick-guide-pane:first-child .row-1');
      const third =
        kind === 'new-plan'
          ? center('.quick-guide-frame:nth-child(2) .quick-guide-demo-control')
          : kind === 'folders'
            ? { x: menu.x + 80, y: menu.y + 80 }
            : kind === 'assign'
              ? target
              : kind === 'create'
                ? center('.quick-guide-preview-confirm')
                : kind === 'undo'
                  ? center('.quick-guide-frame:nth-child(2) .quick-guide-demo-control')
                  : second;
      const points = {
        start: { x: bounds.width / 2, y: bounds.height - 12 },
        first,
        second,
        third,
        'drag-start': source,
        'drag-end': target,
        menu,
        fourth: { x: menu.x + 80, y: menu.y + 52 },
      };
      for (const [name, point] of Object.entries(points)) {
        node.style.setProperty(`--${name}-x`, `${point.x}px`);
        node.style.setProperty(`--${name}-y`, `${point.y}px`);
      }
      node.style.setProperty('--menu-width', `${Math.max(0, (pane?.width ?? 0) - 16)}px`);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [kind, surface]);

  return (
    <Box className="quick-guide-gesture">
      {kind === 'undo' || kind === 'folders' ? (
        <Box
          className="quick-guide-demo-menu"
          padding="s"
          gap="s"
          borderWidth={1}
          borderColor="gray30"
          borderRadius="s"
          backgroundColor="white"
        >
          <Box flexDirection="row" alignItems="center" gap="s">
            <Icon name="folder-open" size={12} color={theme.colors.primary} />
            <Text variant="bodySmall">{kind === 'folders' ? 'New plan' : 'Move to plan'}</Text>
          </Box>
          <Box flexDirection="row" alignItems="center" gap="s">
            <Icon
              name={kind === 'folders' ? 'folder-plus' : 'xmark'}
              size={12}
              color={theme.colors.primary}
            />
            <Text variant="bodySmall">{kind === 'folders' ? 'New subfolder' : 'Unassign'}</Text>
          </Box>
        </Box>
      ) : null}
      {kind === 'folders' ? (
        <>
          <Box
            className="quick-guide-folder-editor folder-parent"
            padding="s"
            borderWidth={1}
            borderColor="primary50"
            borderRadius="sm"
            backgroundColor="white"
          >
            <Text variant="bodySmall" color="gray">
              New folder name
            </Text>
            <Text className="quick-guide-typed-name" variant="bodySmall">
              Demo workspace
            </Text>
            <Text className="quick-guide-enter-key" variant="xSmall" color="gray">
              Enter ↵
            </Text>
          </Box>
          <Box
            className="quick-guide-folder-editor folder-child"
            padding="s"
            borderWidth={1}
            borderColor="primary50"
            borderRadius="sm"
            backgroundColor="white"
          >
            <Text variant="bodySmall" color="gray">
              New folder name
            </Text>
            <Text className="quick-guide-typed-name" variant="bodySmall">
              Operations
            </Text>
            <Text className="quick-guide-enter-key" variant="xSmall" color="gray">
              Enter ↵
            </Text>
          </Box>
        </>
      ) : null}
      {kind === 'new-plan' ? (
        <Box
          className="quick-guide-plan-name-editor"
          padding="s"
          borderWidth={1}
          borderColor="primary50"
          borderRadius="sm"
          backgroundColor="white"
        >
          <Text className="quick-guide-plan-typed-name" variant="bodySmall">
            Access plan
          </Text>
        </Box>
      ) : null}
      {kind === 'create' ? (
        <Box
          className="quick-guide-create-preview"
          padding="m"
          gap="s"
          backgroundColor="white"
          borderWidth={1}
          borderColor="gray10"
          borderRadius="s"
        >
          <Box flexDirection="row" alignItems="center" gap="s">
            <Icon name="plus" size={12} color={theme.colors.primary} />
            <Text variant="bodySmall" semibold>
              Create assets
            </Text>
          </Box>
          {[
            ['API Key', 'Access token'],
            ['Plain Text', 'Region'],
          ].map(([type, field], index) => (
            <Box
              key={type}
              padding="s"
              gap="xxs"
              borderWidth={1}
              borderColor="gray10"
              borderRadius="s"
            >
              <Text variant="bodySmall" semibold>
                Asset type · {type}
              </Text>
              <Text variant="bodySmall">Demo account — Additional {index + 1}</Text>
              <Text variant="bodySmall" color="gray">
                Source field · {field}
              </Text>
            </Box>
          ))}
          <Box
            className="quick-guide-preview-confirm"
            alignSelf="flex-end"
            paddingHorizontal="s"
            paddingVertical="xs"
            backgroundColor="primary"
            borderRadius="sm"
          >
            <Text variant="bodySmall" color="white">
              Confirm
            </Text>
          </Box>
        </Box>
      ) : null}
      {kind === 'assign' || kind === 'group' ? (
        <Box
          className="quick-guide-drag-card"
          padding="s"
          gap="xxs"
          borderRadius="s"
          borderWidth={1}
          borderColor="primary50"
          backgroundColor="white"
        >
          <Box flexDirection="row" alignItems="center" gap="xs">
            <Icon name="layer-group" size={12} color={theme.colors.primary} />
            <Text variant="bodySmall" semibold>
              {kind === 'assign' ? '2 assets' : '3 assets'}
            </Text>
          </Box>
          <Text variant="bodySmall" color="gray">
            Demo API key
          </Text>
        </Box>
      ) : null}
      <Box className="quick-guide-demo-cursor">
        <Box
          className="quick-guide-click-ring"
          borderWidth={2}
          borderColor="primary50"
          borderRadius="pill"
        />
        <Icon name="arrow-pointer" size={22} color={theme.colors.primary120} />
        {kind === 'assign' || kind === 'new-plan' ? (
          <Box
            className="quick-guide-modifier"
            padding="xxs"
            borderWidth={1}
            borderColor="gray30"
            borderRadius="sm"
            backgroundColor="white"
          >
            <Text variant="xSmall" semibold>
              Ctrl/Cmd + click
            </Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
