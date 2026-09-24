import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

interface ChromeManifest {
  readonly manifest_version: number;
  readonly permissions?: readonly string[];
  readonly host_permissions?: readonly string[];
  readonly optional_host_permissions?: readonly string[];
  readonly content_scripts?: unknown;
  readonly background?: { readonly service_worker?: string; readonly type?: string };
  readonly side_panel?: { readonly default_path?: string };
  readonly content_security_policy?: { readonly extension_pages?: string };
  readonly icons?: Readonly<Record<string, string>>;
  readonly action?: { readonly default_icon?: Readonly<Record<string, string>> };
  readonly name?: string;
  readonly short_name?: string;
  readonly version?: string;
  readonly key?: string;
  readonly web_accessible_resources?: readonly { readonly resources: readonly string[]; readonly matches: readonly string[] }[];
}

describe('Chrome MV3 manifest', () => {
  it('uses the InheritiGuard product identity and the canonical app version', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../src/manifest.json', import.meta.url), 'utf8'),
    ) as ChromeManifest;
    const packageManifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { readonly name: string; readonly version: string };

    expect(packageManifest.name).toBe('@safetech/inheritiguard-chrome-extension');
    expect(manifest.name).toBe('InheritiGuard');
    expect(manifest.short_name).toBe('InheritiGuard');
    expect(manifest.version).toBe(packageManifest.version);
  });

  it('keeps the development identity visibly distinct from the production Store item', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../src/manifest.json', import.meta.url), 'utf8'),
    ) as ChromeManifest;
    const digest = createHash('sha256')
      .update(Buffer.from(manifest.key ?? '', 'base64'))
      .digest('hex')
      .slice(0, 32);
    const extensionId = [...digest]
      .map((character) => String.fromCharCode(97 + Number.parseInt(character, 16)))
      .join('');

    expect(extensionId).toBe('gfkgipdabdcjnpobppfcbbaimpjefnnn');
    expect(extensionId).not.toBe('kebghapddpgnfjpkecphjecbffdhodln');
  });

  it('combines Guard permissions while keeping overlay authorization exact-origin', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../src/manifest.json', import.meta.url), 'utf8'),
    ) as ChromeManifest;

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(['activeTab', 'alarms', 'scripting', 'sidePanel', 'identity', 'storage',
      'declarativeNetRequestWithHostAccess', 'downloads', 'idle', 'notifications', 'browsingData', 'cookies', 'webNavigation']);
    expect(manifest.host_permissions).toEqual(['<all_urls>']);
    expect(manifest.optional_host_permissions).toEqual(['https://*/*']);
    expect(manifest.content_scripts).toEqual([
      { matches: ['<all_urls>'], js: ['content/guard-bridge.js'], run_at: 'document_start', all_frames: true, world: 'ISOLATED' },
      { matches: ['<all_urls>'], js: ['content/guard-page.js'], run_at: 'document_start', all_frames: true, world: 'MAIN' },
    ]);
    expect(manifest.background).toEqual({
      service_worker: 'background/service-worker.js',
      type: 'module',
    });
    expect(manifest.side_panel?.default_path).toBe('side-panel/index.html');
    expect(manifest.content_security_policy?.extension_pages).toBe("script-src 'self' 'wasm-unsafe-eval'; object-src 'none'");
    expect(manifest.web_accessible_resources?.[1]).toEqual({
      resources: ['side-panel/assets/inheriti-business-logo.png', 'side-panel/assets/safekey-pro.png',
        'side-panel/assets/safekey-mobile.png'],
      matches: ['https://*/*'],
    });
    const worker = await readFile(new URL('../src/background/service-worker.ts', import.meta.url), 'utf8');
    expect(worker).toContain('chrome.webNavigation?.onBeforeNavigate.addListener');
    expect(worker).toContain('guard.inlineNavigation(details)');
  });

  /**
   * Argon2 master-key derivation is WebAssembly, and Chrome blocks a WASM compile in an extension
   * page unless the policy says so. Measured in Chrome for Testing 149: without this token the
   * service worker throws "Compiling or instantiating WebAssembly module violates ... script-src
   * 'self'" and a DERIVED reveal fails — while every Node test still passes, because Node has no CSP.
   *
   * `'wasm-unsafe-eval'` is not `'unsafe-eval'`: it permits WebAssembly compilation and nothing
   * else. Neither eval nor `new Function` becomes reachable, which is what the two assertions below
   * keep true as a pair.
   */
  it('allows WebAssembly for key derivation without allowing script eval', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../src/manifest.json', import.meta.url), 'utf8'),
    ) as ChromeManifest;
    const tokens = (manifest.content_security_policy?.extension_pages ?? '').split(/[\s;]+/u).filter(Boolean);

    expect(tokens).toContain("'wasm-unsafe-eval'");
    expect(tokens).not.toContain("'unsafe-eval'");
    expect(tokens).not.toContain("'unsafe-inline'");
  });

  it('uses the official icon-only brandmark for Chrome and the toolbar action', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../src/manifest.json', import.meta.url), 'utf8'),
    ) as ChromeManifest;

    expect(manifest.icons).toEqual({
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    });
    expect(manifest.action?.default_icon).toEqual({
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
    });
  });
});
