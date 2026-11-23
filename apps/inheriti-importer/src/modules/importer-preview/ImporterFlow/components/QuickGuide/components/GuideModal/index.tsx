import { useLayoutEffect, useRef, useState } from 'react';
import { BaseModal, Box, Button, Icon, Pressable, Text, theme } from '@main-components';
import { keyboardActivation } from '@modules/_shared/ui/keyboard-activation';
import { guideContent, type GuideStage } from '../../content';
import { useReducedMotion } from '../../hooks/use-reduced-motion';
import { GuideScene } from '../GuideScene';

export function GuideModal({
  stage,
  closing,
  onDismiss,
}: {
  stage: GuideStage;
  closing?: boolean;
  onDismiss: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [replay, setReplay] = useState(0);
  const reducedMotion = useReducedMotion();
  const previousReducedMotion = useRef(reducedMotion);
  const pagination = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const motionControlsRemoved = reducedMotion && !previousReducedMotion.current;
    previousReducedMotion.current = reducedMotion;
    if (!motionControlsRemoved) return;

    const dialog = pagination.current?.closest('[role="dialog"]');
    if (dialog && !dialog.contains(document.activeElement)) {
      pagination.current?.querySelector<HTMLElement>('[aria-current="step"]')?.focus();
    }
  }, [reducedMotion]);
  const { title, scenes } = guideContent[stage];
  const scene = scenes[index];
  const last = index === scenes.length - 1;

  const motionControls = (
    <Box
      className="quick-guide-motion"
      paddingHorizontal={theme.importer.spacing.inspectorPadding}
      flexDirection="row"
      alignItems="center"
      gap="xs"
    >
      <Button title="Skip" variant="plain" color="gray" size="sm" onPress={onDismiss} />
      {reducedMotion ? (
        <Text variant="bodySmall" color="gray">
          Reduced motion is on
        </Text>
      ) : (
        <>
          <Button
            title={paused ? 'Play' : 'Pause'}
            variant="plain"
            size="sm"
            startIcon={
              <Icon name={paused ? 'play' : 'pause'} size={12} color={theme.colors.primary120} />
            }
            onPress={() => setPaused(!paused)}
          />
          <Button
            title="Replay"
            variant="plain"
            size="sm"
            startIcon={<Icon name="rotate-right" size={12} color={theme.colors.primary120} />}
            onPress={() => {
              setReplay(replay + 1);
              setPaused(false);
            }}
          />
        </>
      )}
    </Box>
  );

  return (
    <BaseModal
      visible
      className={`quick-guide-modal${closing ? ' is-closing' : ''}`}
      maxWidth={640}
      title={`Quick guide · ${title}`}
      titleIcon={<Icon name="book-open" size={20} />}
      onDismiss={onDismiss}
      bodyHeader={motionControls}
      footer={
        <Box className="quick-guide-footer" alignItems="center" gap="s" width="100%">
          <Box alignItems="flex-start">
            <Button
              title="Previous"
              variant="outlined"
              color="gray"
              size="sm"
              disabled={index === 0}
              onPress={() => setIndex(index - 1)}
            />
          </Box>
          <Box
            ref={pagination}
            className="quick-guide-pagination"
            flexDirection="row"
            alignItems="center"
            accessibilityLabel="Guide scenes"
            role="group"
          >
            <Text className="quick-guide-scene-count" aria-live="polite">
              {index + 1} of {scenes.length}
            </Text>
            {scenes.map(({ title: sceneTitle }, sceneIndex) => {
              const current = sceneIndex === index;
              const showScene = () => setIndex(sceneIndex);
              return (
                <Pressable
                  key={sceneTitle}
                  accessibilityRole="button"
                  accessibilityLabel={`Show scene ${sceneIndex + 1}: ${sceneTitle}`}
                  aria-current={current ? 'step' : undefined}
                  onPress={showScene}
                  style={{
                    width: 28,
                    height: 28,
                    justifyContent: 'center',
                    alignItems: 'center',
                    borderRadius: theme.radii.pill,
                  }}
                  {...keyboardActivation(showScene)}
                >
                  <Box
                    width={8}
                    height={8}
                    borderRadius="pill"
                    backgroundColor={current ? 'primary' : 'gray30'}
                  />
                </Pressable>
              );
            })}
          </Box>
          <Box alignItems="flex-end">
            <Button
              title={last ? 'Done' : 'Next'}
              size="sm"
              onPress={last ? onDismiss : () => setIndex(index + 1)}
            />
          </Box>
        </Box>
      }
    >
      <GuideScene scene={scene} paused={paused} replay={replay} reducedMotion={reducedMotion} />
    </BaseModal>
  );
}
