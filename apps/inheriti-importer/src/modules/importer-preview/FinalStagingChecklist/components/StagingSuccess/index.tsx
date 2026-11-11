import type { ComponentProps, ComponentType } from 'react';
import { Box, Button, Icon, Pressable, Text, theme } from '@main-components';

const businessImportsUrl = `${__WEB_APP_URL__.replace(/\/$/, '')}/organization/imports`;
const ExternalLink = Pressable as ComponentType<
  ComponentProps<typeof Pressable> & {
    href: string;
    hrefAttrs: { target: '_blank'; rel: 'noreferrer' };
  }
>;

export function StagingSuccess({
  description = 'Finish creating your protection plans in Inheriti® Business.',
  onStartAgain,
}: {
  description?: string;
  onStartAgain?: () => void;
}) {
  return (
    <Box
      className="staging-success"
      alignItems="center"
      justifyContent="center"
      gap="m"
      borderWidth={1}
      borderColor="gray10"
      borderRadius="l"
      backgroundColor="white"
    >
      <Box
        className="staging-success-icon"
        alignItems="center"
        justifyContent="center"
        borderWidth={1}
        borderColor="success30"
        backgroundColor="white"
      >
        <Icon name="circle-check" size={32} color={theme.colors.success120} />
      </Box>
      <Box alignItems="center" gap="s">
        <Text variant="heading2" align="center" color="success120">
          Import staged
        </Text>
        <Text variant="bodyRegular" align="center" color="gray">
          {description}
        </Text>
        <Text variant="bodySmall" align="center" color="gray">
          Staged imports will be deleted in 7 days.
        </Text>
      </Box>
      <Box alignItems="center" gap="s">
        <ExternalLink
          href={businessImportsUrl}
          hrefAttrs={{ target: '_blank', rel: 'noreferrer' }}
          accessibilityRole="link"
          accessibilityLabel="Continue in Inheriti Business"
        >
          <Box
            className="staging-success-link"
            flexDirection="row"
            alignItems="center"
            justifyContent="center"
            gap="s"
            borderWidth={1}
            borderColor="primary"
            borderRadius="s"
            backgroundColor="primary"
          >
            <Text variant="buttonDefault" color="white">
              Continue in Inheriti® Business
            </Text>
            <Icon name="arrow-up-right-from-square" size={12} color={theme.colors.white} />
          </Box>
        </ExternalLink>
        <Button
          title="Start a new import"
          variant="outlined"
          onPress={() => onStartAgain?.()}
          disabled={!onStartAgain}
        />
      </Box>
    </Box>
  );
}

export default StagingSuccess;
