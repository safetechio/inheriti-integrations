import type { SecretStorage } from 'vscode';
import { deriveMasterKey } from '@safetech/inheriti-core-sdk/crypto';

export const MASTER_KEY_PASSPHRASE_SECRET = 'inheritiElements.masterKeyPassphrase';

/**
 * What custody this editor holds locally.
 *
 * The passphrase lives in VS Code's encrypted `SecretStorage`, never in workspace settings, and is
 * read per reveal rather than at activation — the operator may import a configuration long after the
 * extension started. Holding nothing is answered as nothing, and the Client SDK then asks the device
 * that holds the key. A reveal never prompts for the passphrase here.
 */
export class SecretStorageMasterKeySource {
  public constructor(
    private readonly saltHex: string | undefined,
    private readonly secrets: SecretStorage,
  ) {}

  public async resolve(): Promise<string | undefined> {
    if (!this.saltHex) return undefined;
    const secret = await this.secrets.get(MASTER_KEY_PASSPHRASE_SECRET);
    if (!secret) return undefined;
    return deriveMasterKey(secret, this.saltHex);
  }
}
