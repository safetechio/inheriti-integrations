import { Image } from 'react-native-web';
import { FILE_TYPE_ICON_ASSETS } from '@/assets/file-type-icons';
import {
  resolveFileTypeIconKey,
  type FileTypeIconVariant,
  type GenericFileTypeIcon,
} from '@/assets/file-type-icons/catalog';

export function FileTypeIcon({
  extension,
  icon,
  variant = 'outline',
  size = 20,
}: {
  extension?: string;
  icon?: GenericFileTypeIcon;
  variant?: FileTypeIconVariant;
  size?: number;
}) {
  return (
    <Image
      source={{ uri: FILE_TYPE_ICON_ASSETS[resolveFileTypeIconKey({ extension, icon, variant })] }}
      accessibilityLabel={`${icon ?? extension ?? 'file'} file`}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
}
