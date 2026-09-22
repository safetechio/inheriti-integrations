import { describe, expect, it } from 'vitest';
import {
  configurationFromJson,
  readBusinessOrganization,
  readStoredConfiguration,
  writeBusinessOrganization,
  writeMasterKeySecret,
  writeStoredConfiguration,
} from '../src/shared/stored-configuration.js';

function area(values: Record<string, unknown> = {}) {
  const held = { ...values };
  return {
    held,
    get: async (keys: string[]) => Object.fromEntries(
      keys.filter((key) => key in held).map((key) => [key, held[key]]),
    ),
    set: async (next: Record<string, unknown>) => { Object.assign(held, next); },
  };
}

describe('stored configuration', () => {
  it('keeps the selected organization separate for each signed-in identity', async () => {
    const local = area();
    await writeBusinessOrganization(local, 'issuer|TEST|alice', 'org-a');
    await writeBusinessOrganization(local, 'issuer|TEST|bob', 'org-b');
    expect(await readBusinessOrganization(local, 'issuer|TEST|alice')).toBe('org-a');
    expect(await readBusinessOrganization(local, 'issuer|TEST|bob')).toBe('org-b');
    await writeBusinessOrganization(local, 'issuer|TEST|alice');
    expect(await readBusinessOrganization(local, 'issuer|TEST|alice')).toBeUndefined();
    expect(await readBusinessOrganization(local, 'issuer|TEST|bob')).toBe('org-b');
  });

  it('prefers what the options page saved over what the harness injected', async () => {
    const local = area({ apiUrl: 'http://saved', issuer: 'http://issuer', clientId: 'saved', environment: 'TEST' });
    const session = area({ apiUrl: 'http://injected' });

    expect(await readStoredConfiguration(local, session)).toMatchObject({ apiUrl: 'http://saved' });
  });

  it('falls back to the session area, which is where the harness writes', async () => {
    const session = area({ apiUrl: 'http://injected', issuer: 'http://issuer', clientId: 'c', environment: 'TEST' });

    expect(await readStoredConfiguration(area(), session)).toMatchObject({ apiUrl: 'http://injected' });
  });

  it('round-trips what the options page writes', async () => {
    const local = area();
    const values = {
      apiUrl: 'http://api', issuer: 'http://issuer', clientId: 'client', environment: 'TEST',
      applicationId: 'application-1', masterKeyCustody: 'DERIVED', masterKeySalt: 'b'.repeat(64),
    } as const;

    await writeStoredConfiguration(local, { ...values });

    expect(await readStoredConfiguration(local, area())).toMatchObject(values);
  });

  it('clears an old standalone Application when saving Business settings', async () => {
    const local = area({ applicationId: 'old-application' });
    await writeStoredConfiguration(local, {
      apiUrl: 'http://business', issuer: 'http://issuer', clientId: 'chrome', environment: 'TEST',
    });
    expect((await readStoredConfiguration(local, area())).applicationId).toBe('');
  });

  /**
   * The passphrase is the one value that must not survive a browser restart or reach disk. `local`
   * was chosen for configuration precisely because it does both, so the secret is written to the
   * session area instead — and `writeStoredConfiguration` drops it even if a caller passes it.
   */
  it('keeps the operator secret out of the persisted area', async () => {
    const local = area();
    const session = area();

    await writeStoredConfiguration(local, {
      apiUrl: 'http://api', issuer: 'http://issuer', clientId: 'client', environment: 'TEST',
      applicationId: 'application-1', masterKeySecret: 'operator-passphrase',
    } as never);
    await writeMasterKeySecret(session, 'operator-passphrase');

    expect(local.held).not.toHaveProperty('masterKeySecret');
    expect(session.held.masterKeySecret).toBe('operator-passphrase');
    expect(await readStoredConfiguration(local, session)).toMatchObject({
      apiUrl: 'http://api', masterKeySecret: 'operator-passphrase',
    });
  });

  it('reads the secret from the session area even when configuration came from local', async () => {
    const local = area({ apiUrl: 'http://saved', issuer: 'http://i', clientId: 'c', environment: 'TEST', applicationId: 'a' });
    const session = area({ masterKeySecret: 'operator-passphrase' });

    expect(await readStoredConfiguration(local, session)).toMatchObject({
      apiUrl: 'http://saved', masterKeySecret: 'operator-passphrase',
    });
  });

  it('reads the harness file, ignoring the keys the extension does not use', () => {
    const parsed = configurationFromJson(JSON.stringify({
      apiUrl: 'http://api',
      issuer: 'http://issuer',
      clientId: 'client',
      applicationId: 'application-1',
      masterKeySalt: 'b'.repeat(64),
      extensionId: 'ignored',
      keycloakBase: 'ignored',
    }));

    expect(parsed).toEqual({
      apiUrl: 'http://api', issuer: 'http://issuer', clientId: 'client', environment: 'TEST',
      applicationId: 'application-1', masterKeySalt: 'b'.repeat(64),
    });
  });

  it('refuses a file that is missing a required value', () => {
    expect(() => configurationFromJson(JSON.stringify({ apiUrl: 'http://api' }))).toThrow('issuer is missing.');
  });

  it('expands a Business deployment without accepting a foreign endpoint', () => {
    expect(configurationFromJson(JSON.stringify({ deployment: 'dev', apiUrl: 'https://foreign.example' })))
      .toMatchObject({
        deployment: 'dev',
        apiUrl: 'https://business-api-dev.inheriti.com/integrations/',
        issuer: 'https://safeid-dev.safetech.io/realms/SafeID',
      });
    expect(() => configurationFromJson(JSON.stringify({ deployment: 'custom' })))
      .toThrow('Unknown Business deployment');
  });
});
