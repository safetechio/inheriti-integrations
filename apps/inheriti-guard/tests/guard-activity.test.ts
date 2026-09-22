import { describe, expect, it } from 'vitest';
import { createGuardActivity, prependBoundedActivity, sanitizedLocation } from '../src/background/guard/activity.js';

describe('Guard activity privacy', () => {
  it('keeps only an HTTP origin and pathname', () => {
    expect(sanitizedLocation('https://user:password@example.com/a/b?token=secret#fragment')).toEqual({
      origin: 'https://example.com', pathname: '/a/b',
    });
    expect(JSON.stringify(sanitizedLocation('data:text/plain,secret'))).not.toContain('secret');
  });

  it('creates stable-shape entries without accepting arbitrary secret detail', () => {
    expect(createGuardActivity(
      { kind: 'navigation-blocked', url: 'https://example.com/path?q=secret#secret' },
      { now: () => 42, id: () => 'event-1' },
    )).toEqual({ id: 'event-1', kind: 'navigation-blocked', timestamp: 42, origin: 'https://example.com', pathname: '/path' });
  });

  it('keeps newest activity first and bounded', () => {
    const base = Array.from({ length: 3 }, (_, index) => ({ id: String(index), kind: 'idle-lock' as const, timestamp: index }));
    expect(prependBoundedActivity(base, { id: 'new', kind: 'secure-logoff', timestamp: 4 }, 2).map(({ id }) => id))
      .toEqual(['new', '0']);
  });
});
