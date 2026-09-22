import { describe, expect, it } from 'vitest';
import { vscodeExtensionHost } from '../src/index.js';

describe('VS Code host boundary', () => {
  it('uses native surfaces and an external browser', () => {
    expect(vscodeExtensionHost.desktopOnly).toBe(true);
    expect(vscodeExtensionHost.usesNativeSurfaces).toBe(true);
    expect(vscodeExtensionHost.usesExternalBrowser).toBe(true);
  });
});
