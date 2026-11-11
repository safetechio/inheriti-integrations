import importerLogo from '@assets/brand/inheriti-importer-logo.svg';
import businessLogo from '@assets/brand/inheriti-business-logo.png';
import brandmark from '@brand-assets/inheriti-brandmark-full-color.svg';
import type { CSSProperties } from 'react';

type BrandLogoProps = {
  mark?: boolean;
  business?: boolean;
  className?: string;
  style?: CSSProperties;
};

export function BrandLogo({ mark = false, business = false, className, style }: BrandLogoProps) {
  return (
    <img
      className={className ?? (mark ? 'brandmark' : 'brand-logo')}
      style={
        !mark && !business
          ? {
              ...(className === 'auth-logo' ? { width: 'min(260px, 85%)' } : { height: 33 }),
              ...style,
            }
          : style
      }
      src={business ? businessLogo : mark ? brandmark : importerLogo}
      alt={business ? 'Inheriti® Business' : mark ? 'Inheriti' : 'Inheriti Importer'}
    />
  );
}
