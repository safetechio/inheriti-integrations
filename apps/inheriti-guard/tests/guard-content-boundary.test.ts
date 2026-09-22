import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Guard MAIN-world boundary', () => {
  it('keeps Plan Access data out and requires the isolated bridge nonce for settings updates', async () => {
    const page = await readFile(new URL('../src/content/guard-page.ts', import.meta.url), 'utf8');
    const bridge = await readFile(new URL('../src/content/guard-bridge.ts', import.meta.url), 'utf8');
    expect(bridge).toContain('crypto.randomUUID()');
    expect(page).toContain('detail.nonce !== bridgeNonce');
    const executable = `${page}\n${bridge}`.replace(/(^|[^:])\/\/.*$/gmu, '$1');
    expect(executable).not.toMatch(/accessToken|refreshToken|masterKey|passphrase|plaintext/u);
  });

  it('does not couple clipboard enforcement to the global protection flag', async () => {
    const page = await readFile(new URL('../src/content/guard-page.ts', import.meta.url), 'utf8');
    expect(page).toContain('settings.clipboard && !settings.allowRead');
    expect(page).toContain('settings.clipboard && !settings.allowPaste');
    expect(page).not.toContain('settings.protection && settings.clipboard');
  });

  it('observes CSP violations only while protection is enabled and forwards no report details', async () => {
    const bridge = await readFile(new URL('../src/content/guard-bridge.ts', import.meta.url), 'utf8');
    expect(bridge).toContain("document.addEventListener('securitypolicyviolation'");
    expect(bridge).toContain('shouldReportCspViolation(protectionEnabled, event)');
    expect(bridge).toContain("{ type: 'guard-content:csp-violation' }");
    expect(bridge).not.toContain('blockedURI');
    expect(bridge).not.toContain('violatedDirective');
  });
});
