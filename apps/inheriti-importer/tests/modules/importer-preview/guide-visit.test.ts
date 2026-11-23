import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('Quick guide visit preference', () => {
  it('stores only a dismissal flag, separately for each step', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key),
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const visits =
      await import('@modules/importer-preview/ImporterFlow/components/QuickGuide/hooks/guide-visit');
    expect(visits.wasGuideDismissed('assets')).toBe(false);
    visits.rememberGuideDismissal('assets');
    expect(visits.wasGuideDismissed('assets')).toBe(true);
    expect(visits.wasGuideDismissed('plans')).toBe(false);
    expect([...values.values()]).toEqual(['1']);
  });

  it.each([true, false])(
    'keeps dismissal in memory when writing preferences fails (read blocked: %s)',
    async (readBlocked) => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          if (readBlocked) throw new Error('Unavailable');
          return null;
        },
        setItem: () => {
          throw new Error('Unavailable');
        },
      });
      const visits =
        await import('@modules/importer-preview/ImporterFlow/components/QuickGuide/hooks/guide-visit');
      expect(visits.wasGuideDismissed('plans')).toBe(false);
      visits.rememberGuideDismissal('plans');
      expect(visits.wasGuideDismissed('plans')).toBe(true);
    },
  );
});
