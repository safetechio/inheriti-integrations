import { describe, expect, it } from 'vitest';
import { shouldReportCspViolation } from '../src/content/csp-observation-policy.js';

describe('CSP observation trust boundary', () => {
  it('reports only browser-trusted CSP events while protection is enabled', () => {
    expect(shouldReportCspViolation(true, { isTrusted: true })).toBe(true);
    expect(shouldReportCspViolation(false, { isTrusted: true })).toBe(false);
    expect(shouldReportCspViolation(true, { isTrusted: false })).toBe(false);
  });
});
