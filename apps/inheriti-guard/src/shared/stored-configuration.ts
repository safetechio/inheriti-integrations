import { BUSINESS_DEPLOYMENTS, BUSINESS_INTERACTIVE_CLIENT_ID, businessDeployment } from '@safetech/inheriti-elements-core/browser';

export const CONFIGURATION_KEYS = ['apiUrl', 'issuer', 'clientId', 'environment'] as const;
export const APPLICATION_KEY = 'applicationId';

/**
 * Non-secret, and optional: how the Application's master key is held, and the Argon2 salt that
 * `DERIVED` custody derives under. Both are properties of the Application rather than of the
 * operator — the plan service returns the salt to any host that asks, and never returns the verifier — so
 * they belong beside the API origin, not beside the passphrase.
 */
export const CUSTODY_KEYS = ['masterKeyCustody', 'masterKeySalt'] as const;

/**
 * The operator's own secret, and the one value that must never reach `chrome.storage.local`.
 *
 * A passphrase written to disk would outlive the browser and be readable by anything with storage
 * access, which is the property `local` was chosen *against* for tokens. It stays in the session
 * area with them: memory-backed, cleared on restart, unreachable from a content script. Re-entering
 * it once per browser session is the cost, and it is the right one.
 */
export const SESSION_ONLY_KEYS = ['masterKeySecret'] as const;
const ORGANIZATION_PREFERENCES = 'inheritiElements.businessOrganizations';

export type StoredConfiguration = Record<(typeof CONFIGURATION_KEYS)[number], string>
  & Partial<Record<(typeof CUSTODY_KEYS)[number] | typeof APPLICATION_KEY | 'deployment', string>>;

/** The two calls this module makes, so a test can stand in for a real storage area. */
export interface ConfigurationStorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

/**
 * Where an installed extension keeps the values it was configured with.
 *
 * The operator's tokens live in `chrome.storage.session` and must stay there — a service worker that
 * ends takes them with it, which is the point. Configuration is different: an API origin, an issuer,
 * a public client id and an environment name are not secrets, and a page that has to be reconfigured
 * every time the browser restarts is not installed in any useful sense. So configuration is read
 * from the local area, with the session area kept as a fallback for the harness, which writes it
 * there over the DevTools protocol and never touches disk.
 */
export async function readStoredConfiguration(
  local: ConfigurationStorageArea,
  session: ConfigurationStorageArea,
): Promise<Record<string, unknown>> {
  const persisted = [...CONFIGURATION_KEYS, APPLICATION_KEY, ...CUSTODY_KEYS, 'deployment'];
  const stored = await local.get(persisted);
  const configuration = stored.deployment || CONFIGURATION_KEYS.some((key) => typeof stored[key] === 'string' && stored[key] !== '')
    ? stored
    : await session.get(persisted);
  // The secret is always read from the session area and never from `local`, whichever side the rest
  // of the configuration came from.
  return { ...configuration, ...await session.get([...SESSION_ONLY_KEYS]) };
}

export async function writeStoredConfiguration(local: ConfigurationStorageArea, values: StoredConfiguration): Promise<void> {
  const persistable = Object.fromEntries(
    Object.entries(values).filter(([key]) => !(SESSION_ONLY_KEYS as readonly string[]).includes(key)),
  );
  persistable.applicationId = values.applicationId ?? '';
  persistable.deployment = values.deployment ?? '';
  await local.set(persistable);
}

export async function readBusinessOrganization(local: ConfigurationStorageArea, key: string): Promise<string | undefined> {
  const stored = await local.get([ORGANIZATION_PREFERENCES]);
  const selections = stored[ORGANIZATION_PREFERENCES] as Record<string, unknown> | undefined;
  return typeof selections?.[key] === 'string' ? selections[key] as string : undefined;
}

export async function writeBusinessOrganization(local: ConfigurationStorageArea, key: string, organizationId?: string): Promise<void> {
  const stored = await local.get([ORGANIZATION_PREFERENCES]);
  const selections = { ...(stored[ORGANIZATION_PREFERENCES] as Record<string, string> | undefined) };
  if (organizationId === undefined) delete selections[key];
  else selections[key] = organizationId;
  await local.set({ [ORGANIZATION_PREFERENCES]: selections });
}

/** The operator secret, kept out of `local` by construction rather than by remembering to. */
export async function writeMasterKeySecret(session: ConfigurationStorageArea, secret: string): Promise<void> {
  await session.set({ masterKeySecret: secret });
}

/** Reads the harness's `chrome-configuration.json`, which carries a few keys this page does not use. */
export function configurationFromJson(text: string): StoredConfiguration {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Expected a JSON object.');
  const source = parsed as Record<string, unknown>;
  const values = {} as StoredConfiguration;
  const deployment = businessDeployment(source.deployment);
  if (source.deployment !== undefined && !deployment) throw new Error('Unknown Business deployment.');
  if (deployment) {
    Object.assign(values, BUSINESS_DEPLOYMENTS[deployment], { clientId: BUSINESS_INTERACTIVE_CLIENT_ID, deployment });
    if (source.applicationId) throw new Error('Business deployment requires a blank Application id.');
    return values;
  }
  for (const key of CONFIGURATION_KEYS) {
    const value = source[key];
    if (key === 'environment' && (value === undefined || value === '')) {
      values[key] = 'TEST';
      continue;
    }
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`${key} is missing.`);
    values[key] = value.trim();
  }
  if (typeof source.applicationId === 'string' && source.applicationId.trim() !== '') values.applicationId = source.applicationId.trim();
  // Custody travels with the harness file when it has it, and defaults the way the Application does.
  for (const key of CUSTODY_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value.trim() !== '') values[key] = value.trim();
  }
  return values;
}
