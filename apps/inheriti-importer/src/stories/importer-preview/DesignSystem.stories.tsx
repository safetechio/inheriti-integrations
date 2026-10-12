import {
  Badge,
  Box,
  Button,
  FilterChip,
  InteractiveSurface,
  Notice,
  ProgressBar,
  Stack,
  Text,
  type BadgeTone,
} from '@main-components';

const noop = () => undefined;
const tones: BadgeTone[] = ['primary', 'info', 'success', 'warning', 'danger', 'neutral'];

export const BadgeVariants = () => (
  <Stack gap="m">
    <Text variant="heading3">Badge variants</Text>
    <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap="s">
      {tones.map((tone) => (
        <Badge key={tone} tone={tone}>
          {tone}
        </Badge>
      ))}
    </Box>
    <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap="s">
      <Badge tone="primary" variant="solid">
        Primary solid
      </Badge>
      <Badge tone="primary" variant="outline" size="lg">
        Local draft
      </Badge>
      <Badge tone="primary" variant="metadata">
        KeePass
      </Badge>
      <Badge tone="warning" variant="count">
        4
      </Badge>
      <Badge tone="primary" emphasis="selected">
        Selected
      </Badge>
    </Box>
  </Stack>
);

export const ButtonVariants = () => (
  <Stack gap="m">
    <Text variant="heading3">Button variants and states</Text>
    <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap="s">
      <Button title="Primary" onPress={noop} />
      <Button title="Outlined" variant="outlined" onPress={noop} />
      <Button title="Plain" variant="plain" onPress={noop} />
      <Button title="Disabled" disabled onPress={noop} />
      <Button title="Loading" loading onPress={noop} />
    </Box>
  </Stack>
);

export const FilterAndProgressVariants = () => (
  <Stack gap="m">
    <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap="s">
      <FilterChip selected onPress={noop}>
        Selected · 4
      </FilterChip>
      <FilterChip onPress={noop}>Available · 2</FilterChip>
      <FilterChip disabled onPress={noop}>
        Disabled
      </FilterChip>
    </Box>
    <ProgressBar value={72} tone="success" label="Success progress" />
    <ProgressBar value={72} tone="warning" label="Warning progress" />
    <ProgressBar value={72} tone="danger" label="Danger progress" />
    <ProgressBar value={72} tone="primary" label="Primary progress" />
  </Stack>
);

export const NoticeVariants = () => (
  <Stack gap="s">
    <Notice
      compact
      tone="info"
      icon="circle-info"
      title="Information"
      description="Compact supporting detail."
    />
    <Notice
      compact
      tone="success"
      icon="circle-check"
      title="Ready"
      description="Compact supporting detail."
    />
    <Notice
      compact
      tone="warning"
      icon="circle-exclamation"
      title="Needs review"
      description="Compact supporting detail."
    />
    <Notice
      compact
      tone="danger"
      icon="circle-exclamation"
      title="Failed"
      description="Compact supporting detail."
    />
    <Notice
      tone="neutral"
      icon="lock"
      title="Disabled state"
      description="Resolve the blockers to continue."
    />
  </Stack>
);

export const InteractiveSurfaceStates = () => (
  <Box flexDirection="row" flexWrap="wrap" gap="m">
    <InteractiveSurface
      onPress={noop}
      padding="m"
      borderWidth={1}
      borderColor="primary30"
      borderRadius="m"
      backgroundColor="white"
    >
      <Text variant="bodySmall">Interactive surface</Text>
    </InteractiveSurface>
    <InteractiveSurface
      disabled
      onPress={noop}
      padding="m"
      borderWidth={1}
      borderColor="gray30"
      borderRadius="m"
      backgroundColor="gray5"
    >
      <Text variant="bodySmall">Disabled surface</Text>
    </InteractiveSurface>
  </Box>
);
