import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('importer accessibility styles', () => {
  it('provides visible focus and reduced-motion overrides', () => {
    const globalStyles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
    expect(globalStyles).toContain(':focus-visible');
    expect(globalStyles).toContain('var(--importer-shadow-focus)');
    expect(globalStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(globalStyles).toContain('.importer-icon-spinner');
  });
});
