import { PassphraseMasterKeySource } from '@safetech/inheriti-core-sdk/crypto';
import type { MasterKeySource } from '@safetech/inheriti-elements-core';
import type { CliConfiguration } from './configuration.js';

/**
 * What custody this host holds locally, and nothing more.
 *
 * A passphrase and salt mean the CLI can produce the Application key by itself, which is the only
 * shape that works with nobody present. Their absence is not a misconfiguration: it is the
 * non-custodial shape, where the key lives on the owner's phone. Which of the two happens is the
 * Client SDK's decision, made from what the plan service says about this operator — this host only declares
 * what it has. The derived key stays inside the SDK source and is never persisted.
 *
 * A reveal never prompts for the passphrase. A host that cannot derive asks the holder.
 */
export function createCliMasterKeySource(configuration: CliConfiguration): MasterKeySource | undefined {
  if (configuration.masterKeyPassphrase === undefined || configuration.masterKeySalt === undefined) {
    return undefined;
  }
  return new PassphraseMasterKeySource({
    secret: configuration.masterKeyPassphrase,
    saltHex: configuration.masterKeySalt,
  });
}
