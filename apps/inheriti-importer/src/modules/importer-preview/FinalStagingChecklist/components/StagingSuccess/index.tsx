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
  description = 'Go to Inheriti® Business and complete your Protection Plans.',
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
          Import staged successfully
        </Text>
        <Text variant="bodyDefault" align="center" color="gray">
          {description}
        </Text>
        <Text variant="bodySmall" align="center" color="gray">
          Your staged import expires in 7 days. If it expires before you complete the Protection
          Plans, the staged encrypted data is deleted and you will need to import it again.
        </Text>
      </Box>
      <Box alignItems="center" gap="s">
        <ExternalLink
          href={businessImportsUrl}
          hrefAttrs={{ target: '_blank', rel: 'noreferrer' }}
          accessibilityRole="link"
          accessibilityLabel="Go to Inheriti Business"
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
              Go to Inheriti® Business
            </Text>
            <Icon name="arrow-up-right-from-square" size={12} color={theme.colors.white} />
          </Box>
        </ExternalLink>
        <Button
          title="Start again"
          variant="outlined"
          onPress={() => onStartAgain?.()}
          disabled={!onStartAgain}
        />
      </Box>
    </Box>
  );
}

export default StagingSuccess;
