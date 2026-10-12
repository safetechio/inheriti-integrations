import type { ReactNode } from 'react';
import { Box, Pressable, ScrollView, Text } from '@modules/_shared/ui/components/Primitives';
import { Icon } from '@modules/_shared/ui/components/Base/Icon';
import { ModalPortal } from '@modules/_shared/ui/components/Base/Portal';
import { keyboardActivation } from '@modules/_shared/ui/keyboard-activation';

/** Shared header/body/footer modal shell — reuses the panel's spacing classes. */
export function BaseModal({
  visible,
  title,
  description,
  onDismiss,
  footer,
  children,
  maxWidth = 560,
}: {
  visible: boolean;
  title: string;
  description?: string;
  onDismiss: () => void;
  footer?: ReactNode;
  children: ReactNode;
  maxWidth?: number;
}) {
  return (
    <ModalPortal visible={visible} onRequestClose={onDismiss}>
      <Box
        flex={1}
        justifyContent="center"
        alignItems="center"
        position="fixed"
        top={0}
        right={0}
        bottom={0}
        left={0}
        style={{ backgroundColor: 'rgba(15, 16, 72, 0.45)', zIndex: 9999 }}
      >
        <Box
          accessibilityRole="dialog"
          accessibilityLabel={title}
          {...{ 'aria-modal': true }}
          width="100%"
          maxWidth={maxWidth}
          backgroundColor="white"
          borderRadius="m"
          overflow="hidden"
          style={{ maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
        >
          <Box
            className="mw-panel-header"
            flexDirection="row"
            justifyContent="space-between"
            alignItems="flex-start"
            gap="m"
          >
            <Box gap="xs" flex={1}>
              <Text variant="heading3">{title}</Text>
              {description ? (
                <Text variant="bodySmall" color="gray">
                  {description}
                </Text>
              ) : null}
            </Box>
            <Pressable
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel={`Close ${title}`}
              {...keyboardActivation(onDismiss)}
            >
              <Icon name="xmark" type="font-awesome-6" color="gray" />
            </Pressable>
          </Box>
          <ScrollView style={{ flex: 1 }}>
            <Box className="mw-panel-body" gap="m">
              {children}
            </Box>
          </ScrollView>
          {footer ? (
            <Box className="mw-panel-footer" flexDirection="row" justifyContent="flex-end" gap="s">
              {footer}
            </Box>
          ) : null}
        </Box>
      </Box>
    </ModalPortal>
  );
}
