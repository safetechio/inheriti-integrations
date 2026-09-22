import { describe, expect, it } from 'vitest';
import { parseImportedConfiguration } from '../src/import-configuration.js';

describe('imported configuration', () => {
  it('reads the dotted settings the harness generates', () => {
    const { settings, passphrase } = parseImportedConfiguration(JSON.stringify({
      'inheriti.apiUrl': 'http://api',
      'inheriti.applicationId': 'application-1',
      'inheriti.issuer': 'http://issuer',
      'inheriti.clientId': 'client-1',
      'inheriti.environment': 'TEST',
      'inheriti.masterKeySalt': '00'.repeat(16),
      masterKeyPassphrase: 'secret',
    }));

    expect(settings).toEqual({
      apiUrl: 'http://api',
      applicationId: 'application-1',
      issuer: 'http://issuer',
      clientId: 'client-1',
      environment: 'TEST',
      masterKeySalt: '00'.repeat(16),
    });
    expect(passphrase).toBe('secret');
  });

  it('keeps legacy dotted settings import-compatible', () => {
    expect(parseImportedConfiguration(JSON.stringify({
      'inheritiElements.apiUrl': 'http://api',
      'inheritiElements.clientId': 'client-1',
      'inheritiElements.masterKeySalt': '00'.repeat(16),
    })).settings).toEqual({ apiUrl: 'http://api', clientId: 'client-1', masterKeySalt: '00'.repeat(16) });
  });

  it('accepts bare keys too', () => {
    const { settings } = parseImportedConfiguration(JSON.stringify({ apiUrl: 'http://api', clientId: 'client-1' }));

    expect(settings).toEqual({ apiUrl: 'http://api', clientId: 'client-1' });
  });

  it('imports a Business deployment without manually supplied endpoints', () => {
    expect(parseImportedConfiguration(JSON.stringify({ deployment: 'stg' })).settings)
      .toEqual({ deployment: 'stg' });
  });

  it('leaves the passphrase absent rather than empty when the file carries none', () => {
    const parsed = parseImportedConfiguration(JSON.stringify({ apiUrl: 'http://api', clientId: 'client-1' }));

    expect('passphrase' in parsed).toBe(false);
  });

  it('refuses a file that cannot configure a sign-in', () => {
    expect(() => parseImportedConfiguration(JSON.stringify({ apiUrl: 'http://api' })))
      .toThrow('apiUrl and clientId are required.');
    expect(() => parseImportedConfiguration('[]')).toThrow('Expected a JSON object.');
  });
});
