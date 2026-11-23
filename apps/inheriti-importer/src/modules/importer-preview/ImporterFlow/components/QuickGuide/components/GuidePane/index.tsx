import { Box, Icon, Text, theme } from '@main-components';
import type { GuidePaneContent } from '../../content';

const backgrounds = {
  selected: 'primary4',
  warning: 'warning10',
  success: 'success10',
} as const;

export function GuidePane({ pane }: { pane: GuidePaneContent }) {
  const control = pane.control ? (
    <Box
      className={`quick-guide-demo-control${!pane.controlPlacement && (pane.group || pane.title === 'Your organisation') ? ' is-footer-control' : ''}`}
      alignSelf="flex-start"
      paddingHorizontal="s"
      paddingVertical="xs"
      borderWidth={1}
      borderColor="primary30"
      backgroundColor="primary4"
      borderRadius="sm"
    >
      <Text variant="bodySmall" semibold color="primary120">
        {pane.control}
      </Text>
    </Box>
  ) : null;

  return (
    <Box
      className="quick-guide-pane"
      gap="s"
      padding="m"
      borderRadius="s"
      borderWidth={1}
      borderColor="gray10"
      backgroundColor="white"
    >
      <Box flexDirection="row" alignItems="center" gap="xs">
        <Icon name={pane.icon} size={12} color={theme.colors.primary} />
        <Text variant="bodySmall" semibold style={{ flex: 1, minWidth: 0 }}>
          {pane.title}
        </Text>
      </Box>
      {pane.group ? (
        <Box flexDirection="row" alignItems="center" gap="xs">
          <Icon name="file-shield" size={12} color={theme.colors.primary} />
          <Text variant="bodySmall" semibold>
            {pane.group}
          </Text>
        </Box>
      ) : null}
      {pane.controlPlacement === 'top' ? control : null}
      {pane.rows.map(({ label, detail, icon, tone }, index) => (
        <Box
          key={label}
          className={`quick-guide-row row-${index}`}
          gap="xxs"
          paddingHorizontal="s"
          paddingVertical="xs"
          borderRadius="sm"
          backgroundColor={tone ? backgrounds[tone] : 'gray5'}
        >
          <Box flexDirection="row" alignItems="center" gap="xxs" style={{ flex: 1, minWidth: 0 }}>
            {pane.selectable ? (
              <Box className="quick-guide-demo-checkbox">
                <Icon
                  name={tone === 'selected' ? 'square-check' : 'square'}
                  size={12}
                  color={tone === 'selected' ? theme.colors.primary : theme.colors.gray50}
                />
              </Box>
            ) : null}
            {icon ? <Icon name={icon} size={12} color={theme.colors.primary} /> : null}
            <Text variant="bodySmall" style={{ flexShrink: 1 }}>
              {label}
            </Text>
          </Box>
          {pane.controlPlacement === 'row' && index === pane.rows.length - 1 ? control : null}
          {detail ? (
            <Text variant="bodySmall" color={tone === 'warning' ? 'warning200' : 'gray'}>
              {detail}
            </Text>
          ) : null}
        </Box>
      ))}
      {pane.summary ? (
        <Text variant="bodySmall" color="gray">
          {pane.summary}
        </Text>
      ) : null}
      {!pane.controlPlacement ? control : null}
      {pane.choices ? (
        <Box
          className="quick-guide-inline-choices"
          flexDirection="row"
          gap="xxs"
          padding="s"
          borderWidth={1}
          borderColor="primary30"
          borderRadius="s"
          backgroundColor="primary4"
        >
          {pane.choices.map((label) => (
            <Box
              key={label}
              className="quick-guide-demo-choice"
              paddingHorizontal="s"
              paddingVertical="xs"
              borderRadius="pill"
              borderWidth={1}
              borderColor="primary30"
              backgroundColor="white"
            >
              <Text variant="bodySmall" color="primary120">
                {label}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}
      {pane.progress !== undefined ? (
        <Box height={4} borderRadius="pill" backgroundColor="gray10">
          <Box
            height={4}
            width={`${pane.progress}%`}
            borderRadius="pill"
            backgroundColor="primary"
          />
        </Box>
      ) : null}
    </Box>
  );
}
