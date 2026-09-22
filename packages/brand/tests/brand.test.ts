import { describe, expect, it } from 'vitest';
import { elementsBrand, elementsWordmark, inheritiGuardBrand, inheritiGuardShield, noColorFromEnvironment, terminalWordmark } from '../src/index.js';

describe('brand primitives', () => {
  it('remain explicitly temporary', () => {
    expect(elementsBrand.status).toBe('temporary-primitives');
  });

  it('provides canonical InheritiGuard browser branding without replacing Elements exports', () => {
    expect(inheritiGuardBrand.productName).toBe('InheritiGuard');
    expect(inheritiGuardBrand.description).toContain('Protection Plan Access');
    expect(inheritiGuardBrand.colors.primary).toMatch(/^#[0-9A-F]{6}$/u);
    expect(inheritiGuardShield.viewBox).toBe('0 0 26 32');
    expect(inheritiGuardShield.path).toContain('M14.2718');
    expect(elementsWordmark.text).toBe('INHERITI');
  });

  it('marks temporary assets non-publishable and honors NO_COLOR', () => {
    expect(elementsBrand.publishable).toBe(false);
    expect(elementsWordmark.publishable).toBe(false);
    expect(noColorFromEnvironment({ NO_COLOR: '' })).toBe(true);
    expect(terminalWordmark({ noColor: true })).toBe('INHERITI');
    expect(terminalWordmark()).toContain('\u001b[');
  });
});
