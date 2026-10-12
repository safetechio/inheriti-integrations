import { Text } from 'react-native-web';
import fa6Selection from '@assets/fonts/fa6/selection.json';
import { theme } from '@modules/_shared/ui/theme/AppTheme';

type Fa6Selection = { icons: Array<{ properties: { name: string; code: number } }> };

const FA6_GLYPHS: Record<string, string> = {};
for (const icon of (fa6Selection as Fa6Selection).icons) {
  const { name, code } = icon.properties;
  if (name && code && !(name in FA6_GLYPHS)) FA6_GLYPHS[name] = String.fromCodePoint(code);
}

const FALLBACK_GLYPH = FA6_GLYPHS.cube ?? '?';

export function Icon({
  name,
  size = 18,
  numberSize,
  color = theme.colors.primary120,
  label,
  type = 'font-awesome-6',
}: {
  name?: string;
  size?: number | string;
  numberSize?: number;
  color?: string;
  label?: string;
  type?: 'font-awesome-6';
}) {
  const glyph = FA6_GLYPHS[name ?? 'cube'] ?? FALLBACK_GLYPH;
  const resolvedSize = numberSize ?? (typeof size === 'number' ? size : 18);
  return (
    <Text
      accessibilityLabel={label ?? name ?? 'Icon'}
      testID={type}
      style={{ fontFamily: 'FA6', color, fontSize: resolvedSize, lineHeight: resolvedSize }}
    >
      {glyph}
    </Text>
  );
}
