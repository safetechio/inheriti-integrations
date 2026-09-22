import { describe, expect, it } from 'vitest';
import { shouldTrapInlineNavigation } from '../src/background/guard/inline-navigation-policy.js';

describe('Guard inline document navigation trap', () => {
  it.each([
    'data:text/html,<h1>fake</h1>',
    'data:application/xhtml+xml,<html/>',
    'data:image/svg+xml,<svg/>',
    'blob:https://app.inheriti.com/9b23',
  ])('traps top-frame inline document %s with ecosystem provenance', (destination) => {
    expect(shouldTrapInlineNavigation({ enabled: true, frameId: 0, destination,
      currentTabUrl: 'https://app.inheriti.com/plans' })).toBe(true);
  });

  it('accepts an ecosystem opener or ecosystem blob origin as browser-owned provenance', () => {
    expect(shouldTrapInlineNavigation({ enabled: true, frameId: 0, destination: 'data:text/html,hello',
      openerTabUrl: 'https://business.inheriti.com/plans' })).toBe(true);
    expect(shouldTrapInlineNavigation({ enabled: true, frameId: 0,
      destination: 'blob:https://safeid-prod.safetech.io/1234' })).toBe(true);
  });

  it('does not trap when disabled, in a child frame, without provenance, or for other data', () => {
    const candidate = { enabled: true, frameId: 0, destination: 'data:text/html,hello',
      currentTabUrl: 'https://external.example/' };
    expect(shouldTrapInlineNavigation({ ...candidate, enabled: false,
      currentTabUrl: 'https://app.inheriti.com/' })).toBe(false);
    expect(shouldTrapInlineNavigation({ ...candidate, frameId: 1,
      currentTabUrl: 'https://app.inheriti.com/' })).toBe(false);
    expect(shouldTrapInlineNavigation(candidate)).toBe(false);
    expect(shouldTrapInlineNavigation({ ...candidate, destination: 'data:text/plain,hello',
      currentTabUrl: 'https://app.inheriti.com/' })).toBe(false);
    expect(shouldTrapInlineNavigation({ ...candidate, destination: 'blob:https://external.example/id' })).toBe(false);
  });
});
