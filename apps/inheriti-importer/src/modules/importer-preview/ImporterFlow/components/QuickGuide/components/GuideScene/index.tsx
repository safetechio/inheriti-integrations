import { useLayoutEffect, useRef, useState } from 'react';
import { Box, Text } from '@main-components';
import type { GuideSceneContent } from '../../content';
import { GuideIllustration } from '../GuideIllustration';

export function GuideScene({
  scene,
  paused,
  replay,
  reducedMotion,
}: {
  scene: GuideSceneContent;
  paused: boolean;
  replay: number;
  reducedMotion: boolean;
}) {
  const content = useRef<HTMLElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const node = content.current;
    if (!node) return;

    const measure = () => {
      const nextHeight = node.getBoundingClientRect().height;
      if (nextHeight > 0) setHeight(nextHeight);
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [scene]);

  return (
    <Box className="quick-guide-scene-shell" height={height} aria-live="polite">
      <Box key={scene.title} ref={content} className="quick-guide-scene-content" gap="s">
        <Text accessibilityRole="heading" variant="heading3" semibold>
          {scene.title}
        </Text>
        <GuideIllustration
          key={`${replay}-${reducedMotion}`}
          frames={scene.frames}
          gesture={scene.gesture}
          paused={paused}
          reducedMotion={reducedMotion}
        />
        {scene.gesture === 'accept' ||
        scene.gesture === 'assign' ||
        scene.gesture === 'new-plan' ? (
          <Box
            className="quick-guide-shortcuts"
            padding="s"
            borderWidth={1}
            borderColor="primary30"
            borderRadius="s"
            backgroundColor="primary4"
            gap="xxs"
          >
            <Text variant="bodySmall">
              <Text semibold>Ctrl/Cmd + click</Text> toggle · <Text semibold>Shift + click</Text>{' '}
              select a range
            </Text>
            <Text variant="bodySmall">
              <Text semibold>Ctrl/Cmd + A / Select all</Text> all matching ·{' '}
              <Text semibold>Esc</Text> clear
            </Text>
            <Text variant="bodySmall" color="gray">
              Drag from a gap to select an area. Ctrl/Cmd + drag adds items.
            </Text>
          </Box>
        ) : null}
        <Text className="quick-guide-caption" variant="bodySmall" color="gray">
          {scene.caption.split(/(\*\*.*?\*\*)/).map((part, index) =>
            part.startsWith('**') ? (
              <Text key={index} variant="bodySmall" semibold color="gray">
                {part.slice(2, -2)}
              </Text>
            ) : (
              part
            ),
          )}
        </Text>
      </Box>
    </Box>
  );
}
