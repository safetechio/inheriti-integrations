import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  isCatalogUrl,
  isCatalogRequest,
  catalogContentSecurityPolicy,
} = require('../../testing/visual-catalog/policy.cjs');

describe('synthetic Electron catalog boundary', () => {
  it.each([
    { isPackaged: true, enabled: '1' },
    { isPackaged: false, enabled: undefined },
  ])('refuses to create a window without the development gate: %j', ({ isPackaged, enabled }) => {
    const exitCodes: number[] = [];
    runInNewContext(
      readFileSync(new URL('../../testing/visual-catalog/main.cjs', import.meta.url), 'utf8'),
      {
        require: (name: string) =>
          name === 'electron'
            ? { app: { isPackaged, exit: (code: number) => exitCodes.push(code) } }
            : name === './policy.cjs'
              ? { isCatalogUrl, catalogContentSecurityPolicy }
              : require(name),
        process: { env: { INHERITI_VISUAL_CATALOG: enabled } },
        console: { error: () => undefined },
      },
    );
    expect(exitCodes).toEqual([1]);
  });

  it('allows only the dedicated loopback origin', () => {
    expect(isCatalogUrl('http://127.0.0.1:6110/?story=importer')).toBe(true);
    for (const url of [
      'http://127.0.0.1:5173',
      'http://localhost:6110',
      'http://127.0.0.1:6111',
      'ws://127.0.0.1:6111',
      'https://business.localhost:3400',
      'file:///tmp/secret',
      'javascript:alert(1)',
      'data:text/html,hello',
      'not a URL',
    ]) {
      expect(isCatalogUrl(url)).toBe(false);
    }
  });

  it('allows HMR only on its dedicated loopback WebSocket origin', () => {
    expect(isCatalogRequest('http://127.0.0.1:6110/meta.json')).toBe(true);
    expect(isCatalogRequest('ws://127.0.0.1:6111/')).toBe(true);
    for (const url of [
      'ws://localhost:6111/',
      'ws://127.0.0.1:6110/',
      'ws://127.0.0.1:6112/',
      'wss://127.0.0.1:6111/',
      'http://business.localhost:3400/',
    ]) {
      expect(isCatalogRequest(url)).toBe(false);
    }
  });

  it('keeps remote connections and embedded content out of the catalog', () => {
    const policy = catalogContentSecurityPolicy();
    expect(policy).toContain("connect-src 'self' ws://127.0.0.1:6111");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
  });
});
