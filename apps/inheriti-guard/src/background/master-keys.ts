import { PassphraseMasterKeySource, RawMasterKeySource } from '@safetech/inheriti-core-sdk/crypto';
import type { DeclaredMasterKeySource } from '@safetech/inheriti-elements-core';
import type { ChromeConfiguration } from '../shared/configuration.js';

/**
 * What custody this extension holds locally, composed to match how the Application's key was declared.
 *
 * The plan service records custody on the Application itself and refuses to change it once plans exist, so
 * the host does not get to pick: `DERIVED` reproduces the key from the operator's secret and the
 * Application's Argon2 salt, `EXTERNAL` takes key material the operator supplies whole. Holding
 * neither is a real state rather than a misconfiguration — the Client SDK then asks the device that
 * holds the key, and this host never chooses between the two paths or speaks the relay protocol.
 *
 * The secret is read from `chrome.storage.session`, the same memory-backed, restart-cleared area the
 * operator's tokens live in and which no content script can reach. The derived key is never written
 * anywhere: it stays inside the SDK's key vault for the life of the service worker.
 */
export function createChromeMasterKeySource(configuration: ChromeConfiguration): DeclaredMasterKeySource {
  const source = sourceFor(configuration);
  return { resolve: async () => source?.resolve() };
}

function sourceFor(configuration: ChromeConfiguration): { resolve(): Promise<string> } | undefined {
  if (configuration.masterKeySecret === undefined) return undefined;
  if (configuration.masterKeyCustody === 'EXTERNAL') {
    return new RawMasterKeySource(configuration.masterKeySecret);
  }
  if (configuration.masterKeySalt === undefined) return undefined;
  return new PassphraseMasterKeySource({
    secret: configuration.masterKeySecret,
    saltHex: configuration.masterKeySalt,
  });
}
