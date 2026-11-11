import logoFullColor from '@brand-assets/inheriti-logo-full-color.svg';
import businessLogo from '@assets/brand/inheriti-business-logo.png';
import brandmark from '@brand-assets/inheriti-brandmark-full-color.svg';
import type { CSSProperties } from 'react';
import { Box, Text } from '@modules/_shared/ui/components';

type BrandLogoProps = {
  mark?: boolean;
  business?: boolean;
  className?: string;
  style?: CSSProperties;
};

export function BrandLogo({ mark = false, business = false, className, style }: BrandLogoProps) {
  if (!mark && !business)
    return (
      <Box
        className={className ?? 'brand-logo'}
        alignItems="center"
        justifyContent="center"
        style={{
          ...style,
          height: 'auto',
          width: className === 'auth-logo' ? 'min(260px, 85%)' : 'auto',
          minWidth: 0,
        }}
      >
        <img
          src={logoFullColor}
          alt="Inheriti"
          style={{
            display: 'block',
            height: className === 'auth-logo' ? 'auto' : 33,
            width: className === 'auth-logo' ? '100%' : 'auto',
            maxWidth: '100%',
          }}
        />
        <Text
          color="primary150"
          style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, lineHeight: 14 }}
        >
          IMPORTER
        </Text>
      </Box>
    );
  return (
    <img
      className={className ?? (mark ? 'brandmark' : 'brand-logo')}
      style={style}
      src={business ? businessLogo : mark ? brandmark : logoFullColor}
      alt={business ? 'Inheriti® Business' : 'Inheriti'}
    />
  );
}
