import { describe, expect, it } from 'vitest';
import { FakeKeyedStore, FakeSecureStore, safeFixtures, testKitBoundary } from '../src/index.js';

describe('test-kit boundary', () => {
  it('is test-only', () => {
    expect(testKitBoundary.productionImportAllowed).toBe(false);
  });

  it('provides generic in-memory fakes and visibly invalid fixtures', async () => {
    const secure = new FakeSecureStore<{ token: string }>();
    await secure.save({ token: safeFixtures.accessToken });
    expect(await secure.load()).toEqual({ token: 'fixture.invalid.token' });
    const keyed = new FakeKeyedStore<{ state: string }>();
    await keyed.save('flow', { state: 'fixture-state' });
    expect(await keyed.load('flow')).toEqual({ state: 'fixture-state' });
    expect(JSON.stringify(safeFixtures)).toContain('.invalid');
  });
});
