import type { ReactNode } from 'react';
import { Box, Text, theme, type BoxProps } from '@modules/_shared/ui/components/Primitives';
import { Icon } from '@modules/_shared/ui/components/Base/Icon';
import type { Theme } from '@modules/_shared/ui/theme/AppTheme';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

export interface NoticeProps extends Omit<BoxProps, 'children'> {
  title: ReactNode;
  description?: ReactNode;
  tone?: NoticeTone;
  icon?: string;
  iconSize?: number;
  compact?: boolean;
}

const toneTokens: Record<
  NoticeTone,
  {
    backgroundColor: keyof Theme['colors'];
    borderColor: keyof Theme['colors'];
    foregroundColor: keyof Theme['colors'];
  }
> = {
  info: { backgroundColor: 'info10', borderColor: 'info30', foregroundColor: 'info120' },
  success: {
    backgroundColor: 'success10',
    borderColor: 'success30',
    foregroundColor: 'success120',
  },
  warning: {
    backgroundColor: 'warning10',
    borderColor: 'warning30',
    foregroundColor: 'warning200',
  },
  danger: { backgroundColor: 'danger10', borderColor: 'danger30', foregroundColor: 'danger120' },
  neutral: { backgroundColor: 'gray5', borderColor: 'gray10', foregroundColor: 'gray' },
};

export function Notice({
  title,
  description,
  tone = 'info',
  icon,
  iconSize = 14,
  compact = false,
  style,
  ...props
}: NoticeProps) {
  const tokens = toneTokens[tone];
  return (
    <Box
      {...props}
      flexDirection="row"
      alignItems={compact ? 'flex-start' : 'center'}
      gap={compact ? 's' : 'm'}
      padding={compact ? theme.importer.spacing.sectionGap : theme.importer.spacing.cardPadding}
      borderWidth={1}
      borderRadius={compact ? 'm' : 'l'}
      borderColor={tokens.borderColor}
      backgroundColor={tokens.backgroundColor}
      style={style}
    >
      {icon ? (
        <Icon name={icon} size={iconSize} color={theme.colors[tokens.foregroundColor]} />
      ) : null}
      <Box flex={1} gap="xxs">
        <Text
          variant={compact ? 'importerNoticeTitle' : 'importerStagingTitle'}
          color={tokens.foregroundColor}
        >
          {title}
        </Text>
        {description ? (
          <Text variant="importerNoticeDetail" color={tokens.foregroundColor}>
            {description}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}

export default Notice;
