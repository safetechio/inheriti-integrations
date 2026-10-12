import logoFullColor from '@assets/brand/inheriti-logo-full-color.svg';
import businessLogo from '@assets/brand/inheriti-business-logo.png';
import brandmark from '@assets/brand/inheriti-brandmark-full-color.svg';
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
      style={style}
      src={business ? businessLogo : mark ? brandmark : logoFullColor}
      alt={business ? 'Inheriti® Business' : 'Inheriti'}
    />
  );
}
