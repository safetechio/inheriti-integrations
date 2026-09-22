import { describe, expect, it } from 'vitest';
import { PendingTabContextStore } from '../src/background/pending-tab-context.js';

describe('PendingTabContextStore', () => {
  it('rejects unsupported pages and invalidates navigation across origins', () => {
    const store = new PendingTabContextStore();
    expect(store.set(7, 'chrome://settings')).toBeUndefined();
    expect(store.set(7, 'https://accounts.example.test/login')).toEqual({
      tabId: 7,
      origin: 'https://accounts.example.test',
    });

    store.invalidateForNavigation(7, 'https://accounts.example.test/next');
    expect(store.get(7)).toBeDefined();
    store.invalidateForNavigation(7, 'https://other.example.test/login');
    expect(store.get(7)).toBeUndefined();
  });

  it('invalidates context when the active tab changes or closes', () => {
    const store = new PendingTabContextStore();
    store.set(7, 'https://accounts.example.test/login');
    store.invalidateForTabChange(8);
    expect(store.get(7)).toBeUndefined();

    store.set(9, 'https://accounts.example.test/login');
    store.invalidateTab(9);
    expect(store.get(9)).toBeUndefined();
  });
});
