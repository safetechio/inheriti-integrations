import { useRef } from 'react';
import { Box, Icon, Text, theme } from '@main-components';
import type { GuideFrame, GuideGestureKind } from '../../content';
import { GuidePane } from '../GuidePane';
import { GuideGesture } from '../GuideGesture';

export function GuideIllustration({
  frames,
  gesture,
  paused,
  reducedMotion,
}: {
  frames: readonly GuideFrame[];
  gesture: GuideGestureKind;
  paused: boolean;
  reducedMotion: boolean;
}) {
  const surface = useRef<HTMLElement>(null);
  return (
    <Box
      ref={surface}
      className={`quick-guide-illustration gesture-${gesture}${paused ? ' is-paused' : ''}${reducedMotion ? ' is-static' : ''}`}
      aria-hidden="true"
      backgroundColor="gray5"
      borderColor="gray10"
      borderWidth={1}
      borderRadius="m"
      padding="s"
    >
      {frames.map(({ action, left, right, reverse }) => (
        <Box key={action} className="quick-guide-frame" gap="xs">
          <Box
            alignSelf="flex-start"
            paddingHorizontal="xs"
            paddingVertical="xxs"
            backgroundColor="primary4"
            borderRadius="pill"
          >
            <Text variant="bodySmall" semibold color="primary120">
              {action}
            </Text>
          </Box>
          <Box className="quick-guide-panes" gap="xs" flexDirection="row">
            <GuidePane pane={left} />
            <Box
              className="quick-guide-arrow"
              alignSelf="center"
              alignItems="center"
              justifyContent="center"
              width={28}
              height={28}
              borderRadius="pill"
              borderWidth={1}
              borderColor="primary30"
              backgroundColor="white"
            >
              <Icon
                name={reverse ? 'arrow-left' : 'arrow-right'}
                size={12}
                color={theme.colors.primary}
              />
            </Box>
            <GuidePane pane={right} />
          </Box>
        </Box>
      ))}
      {!reducedMotion ? <GuideGesture kind={gesture} surface={surface} /> : null}
    </Box>
  );
}
