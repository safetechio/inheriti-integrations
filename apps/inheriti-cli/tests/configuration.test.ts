import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CliConfigurationInvalid, defaultConfigurationPath, resolveConfiguration } from '../src/configuration.js';

// Every case names a configuration home of its own: a file left on the machine running the tests
// must never stand in for one a case did not write.
const configurationHome = mkdtempSync(resolve(tmpdir(), 'inheriti-elements-configuration-'));
afterAll(() => { rmSync(configurationHome, { recursive: true, force: true }); });

const base = {
  XDG_CONFIG_HOME: configurationHome,
  INHERITI_ELEMENTS_API_URL: 'http://127.0.0.1:3201',
  INHERITI_ELEMENTS_APPLICATION_ID: 'application-1',
  INHERITI_ELEMENTS_ISSUER: 'http://127.0.0.1:4564/realms/elements',
  INHERITI_ELEMENTS_CLIENT_ID: 'elements-test-cli-device',
};

function withConfigurationFile(contents: string): { INHERITI_ELEMENTS_CONFIG: string } {
  const path = resolve(configurationHome, `config-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, contents, { encoding: 'utf8', mode: 0o600 });
  return { INHERITI_ELEMENTS_CONFIG: path };
}

describe('CLI configuration', () => {
  it('defaults to TEST when the operator names no environment', () => {
    expect(resolveConfiguration(base).environment).toBe('TEST');
  });

  it('refuses LIVE in a development build even with an explicit confirmation', () => {
    expect(() => resolveConfiguration({ ...base, INHERITI_ELEMENTS_ENVIRONMENT: 'LIVE' }, 'LIVE'))
      .toThrow(CliConfigurationInvalid);
    try {
      resolveConfiguration({ ...base, INHERITI_ELEMENTS_ENVIRONMENT: 'LIVE' }, 'LIVE');
    } catch (error) {
      expect((error as CliConfigurationInvalid).code).toBe('live_environment_unavailable_in_development_build');
    }
  });

  it('refuses an environment it does not recognise rather than guessing', () => {
    expect(() => resolveConfiguration({ ...base, INHERITI_ELEMENTS_ENVIRONMENT: 'STAGING' })).toThrow(CliConfigurationInvalid);
  });

  it('requires every endpoint rather than defaulting to someone else’s Elements', () => {
    for (const missing of Object.keys(base)) {
      if (missing === 'XDG_CONFIG_HOME') continue;
      const partial = { ...base, [missing]: undefined };
      expect(() => resolveConfiguration(partial)).toThrow(CliConfigurationInvalid);
    }
  });

  it('keeps standalone Elements scopes', () => {
    expect(resolveConfiguration(base).scopes).toEqual([
      'openid', 'plan:list', 'plan:read', 'plan:reveal', 'asset:copy',
    ]);
  });

  it('accepts custody inputs only as a complete passphrase and salt pair', () => {
    expect(() => resolveConfiguration({ ...base, INHERITI_ELEMENTS_MASTER_KEY_PASSPHRASE: 'secret' }))
      .toThrow(CliConfigurationInvalid);
    expect(resolveConfiguration({
      ...base,
      INHERITI_ELEMENTS_MASTER_KEY_PASSPHRASE: 'secret',
      INHERITI_ELEMENTS_MASTER_KEY_SALT: '00'.repeat(16),
    })).toMatchObject({
      applicationId: 'application-1',
      masterKeyPassphrase: 'secret',
      masterKeySalt: '00'.repeat(16),
    });
  });

  it('reads its configuration from a file, so an installed binary needs no exported environment', () => {
    const configured = withConfigurationFile(JSON.stringify({
      apiUrl: 'http://127.0.0.1:3201',
      applicationId: 'application-1',
      issuer: 'http://127.0.0.1:4564/realms/elements',
      clientId: 'elements-test-cli-device',
      masterKeyPassphrase: 'secret',
      masterKeySalt: '00'.repeat(16),
    }));
    expect(resolveConfiguration(configured)).toMatchObject({
      apiUrl: 'http://127.0.0.1:3201',
      applicationId: 'application-1',
      clientId: 'elements-test-cli-device',
      environment: 'TEST',
      masterKeyPassphrase: 'secret',
    });
  });

  it('uses Business mode from the config file without requiring an Application id or new environment setting', () => {
    const configured = withConfigurationFile(JSON.stringify({
      business: true,
      apiUrl: 'http://127.0.0.1:3201',
      issuer: 'http://127.0.0.1:4564/realms/elements',
      clientId: 'business-cli-device',
      interactiveClientId: 'business-cli-interactive',
    }));
    expect(resolveConfiguration(configured)).toMatchObject({ business: true, clientId: 'business-cli-device', interactiveClientId: 'business-cli-interactive', scopes: ['openid'] });
    expect(resolveConfiguration(configured).applicationId).toBeUndefined();
    expect(resolveConfiguration({ ...configured, INHERITI_ELEMENTS_CLIENT_ID: 'stale-client', INHERITI_ELEMENTS_APPLICATION_ID: 'stale-application' }))
      .toMatchObject({ business: true, clientId: 'business-cli-device' });
    expect(() => resolveConfiguration(withConfigurationFile(JSON.stringify({ business: true, applicationId: 'fake' }))))
      .toThrow('Business configuration must not include applicationId');
    expect(() => resolveConfiguration(withConfigurationFile(JSON.stringify({ business: true }))))
      .toThrow('Set apiUrl in the CLI configuration');
  });

  it('selects a Business deployment atomically and rejects prod in this development build', () => {
    const configured = withConfigurationFile(JSON.stringify({ business: true, deployment: 'stg', apiUrl: 'http://stale' }));
    expect(resolveConfiguration(configured)).toMatchObject({
      apiUrl: 'https://business-api-stg.inheriti.com/integrations/',
      issuer: 'https://safeid-stg.safetech.io/realms/SafeID',
      clientId: 'inheriti-business-integrations-device',
      environment: 'TEST',
    });
    expect(() => resolveConfiguration(withConfigurationFile(JSON.stringify({ business: true, deployment: 'prod' }))))
      .toThrow('production build is required');
  });

  it('binds a configured SafeKey PRO device to the Business UI hostname', () => {
    const configured = withConfigurationFile(JSON.stringify({ business: true, deployment: 'local', safeKeyProDevice: '/dev/hidraw4' }));
    expect(resolveConfiguration(configured)).toMatchObject({ safeKeyProDevice: '/dev/hidraw4', safeKeyProRpId: 'business.localhost' });
    expect(resolveConfiguration({ ...configured, INHERITI_SAFEKEY_PRO_DEVICE: '/dev/hidraw5' }))
      .toMatchObject({ safeKeyProDevice: '/dev/hidraw5', safeKeyProRpId: 'business.localhost' });
  });

  it('offers SafeKey PRO for Business even before the device is connected', () => {
    const configured = withConfigurationFile(JSON.stringify({ business: true, deployment: 'local' }));
    expect(resolveConfiguration(configured)).toMatchObject({ safeKeyProRpId: 'business.localhost' });
    expect(resolveConfiguration(configured).safeKeyProDevice).toBeUndefined();
  });

  it('lets an exported variable win over the file rather than the other way round', () => {
    const configured = withConfigurationFile(JSON.stringify({
      apiUrl: 'http://127.0.0.1:3201',
      applicationId: 'application-1',
      issuer: 'http://127.0.0.1:4564/realms/elements',
      clientId: 'from-the-file',
    }));
    expect(resolveConfiguration({ ...configured, INHERITI_ELEMENTS_CLIENT_ID: 'from-the-environment' }).clientId)
      .toBe('from-the-environment');
  });

  it('refuses a configuration file it cannot parse instead of behaving as if there were none', () => {
    const configured = withConfigurationFile('{ not json');
    expect(() => resolveConfiguration(configured)).toThrow(CliConfigurationInvalid);
  });

  it('resolves the configuration path from the operator’s own configuration home', () => {
    expect(defaultConfigurationPath(base)).toBe(resolve(configurationHome, 'inheriti-elements', 'config.json'));
    expect(defaultConfigurationPath({ HOME: '/home/operator' }))
      .toBe('/home/operator/.config/inheriti-elements/config.json');
  });
});
