import { describe, expect, it } from 'vitest';
import { createCliMasterKeySource } from '../src/master-keys.js';
import type { CliConfiguration } from '../src/configuration.js';

const configuration: CliConfiguration = {
  apiUrl: 'http://127.0.0.1:3201',
  applicationId: 'application-1',
  issuer: 'http://issuer.test',
  interactiveClientId: 'elements-test-cli-interactive',
  clientId: 'cli',
  environment: 'TEST',
  scopes: ['openid'],
  redirectUri: 'http://127.0.0.1/callback',
};

/**
 * This host declares custody and nothing else. Choosing between deriving and asking the device that
 * holds the key belongs to the Client SDK, and is covered by its own suite — a host that decided it
 * here would be a second implementation to keep in step with two others.
 */
describe('CLI master-key custody', () => {
  it('declares no custody when none is configured, so the SDK asks the key holder', () => {
    expect(createCliMasterKeySource(configuration)).toBeUndefined();
  });

  it('derives from the configured passphrase and salt', async () => {
    const source = createCliMasterKeySource({
      ...configuration,
      masterKeyPassphrase: 'correct horse battery staple',
      masterKeySalt: '00'.repeat(16),
    });

    await expect(source?.resolve()).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  /** Half a configuration is refused earlier, at `resolveConfiguration`; this is the other guard. */
  it('declares nothing when only one half of the pair is present', () => {
    expect(createCliMasterKeySource({ ...configuration, masterKeyPassphrase: 'secret' })).toBeUndefined();
    expect(createCliMasterKeySource({ ...configuration, masterKeySalt: '00'.repeat(16) })).toBeUndefined();
  });
});
