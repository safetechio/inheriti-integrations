import { describe, expect, it } from 'vitest';
import { chromeExtensionHost } from '../src/index.js';

describe('Chrome host boundary', () => {
  it('pins MV3 without a persistent content script', () => {
    expect(chromeExtensionHost.manifestVersion).toBe(3);
    expect(chromeExtensionHost.persistentContentScript).toBe(false);
    expect(chromeExtensionHost.activation).toBe('explicit-user-action');
    expect(chromeExtensionHost.environment).toBe('TEST');
  });
});
