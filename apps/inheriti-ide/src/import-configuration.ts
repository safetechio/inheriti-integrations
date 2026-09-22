const SETTING_KEYS = ['deployment', 'apiUrl', 'applicationId', 'issuer', 'clientId', 'environment', 'masterKeySalt'] as const;
const PASSPHRASE_KEY = 'masterKeyPassphrase';
const PREFIX = 'inheritiElements.';

export interface ImportedConfiguration {
  settings: Record<string, string>;
  passphrase?: string;
}

/**
 * Reads a configuration file into the settings the extension needs, and the one secret it needs.
 *
 * An installed extension has no harness writing its `settings.json` for it, and the master key
 * passphrase has no home in settings at all — SecretStorage is the only place it may go, and until
 * now nothing ever put it there, so a reveal could never find it. Both halves come from one file so
 * a manual session is one command rather than six fields typed by hand.
 *
 * Accepts either shape the harness writes: dotted `inheritiElements.apiUrl` keys, or bare ones.
 */
export function parseImportedConfiguration(text: string): ImportedConfiguration {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Expected a JSON object.');
  const source = parsed as Record<string, unknown>;
  const read = (key: string): string | undefined => {
    const value = source[`${PREFIX}${key}`] ?? source[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  };

  const settings: Record<string, string> = {};
  for (const key of SETTING_KEYS) {
    const value = read(key);
    if (value !== undefined) settings[key] = value;
  }
  if (settings.deployment === undefined && (settings.apiUrl === undefined || settings.clientId === undefined)) {
    throw new Error('apiUrl and clientId are required.');
  }

  const passphrase = read(PASSPHRASE_KEY);
  return passphrase === undefined ? { settings } : { settings, passphrase };
}
