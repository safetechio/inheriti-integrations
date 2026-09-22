import {
  CONFIGURATION_KEYS,
  APPLICATION_KEY,
  configurationFromJson,
  readStoredConfiguration,
  writeStoredConfiguration,
  type StoredConfiguration,
} from '../shared/stored-configuration.js';
import { inheritiGuardBrand } from '@safetech/inheriti-elements-brand';
import { BUSINESS_DEPLOYMENTS, BUSINESS_INTERACTIVE_CLIENT_ID, businessDeployment } from '@safetech/inheriti-elements-core/browser';
import { resolveConfiguration } from '../shared/configuration.js';

document.documentElement.style.setProperty('--brand-primary', inheritiGuardBrand.colors.primary);

/** Everything the page renders a text input for. */
const EDITABLE_KEYS = [...CONFIGURATION_KEYS, APPLICATION_KEY] as const;

/**
 * The only way an installed extension can be configured.
 *
 * In the harness the values arrive over the DevTools protocol, which needs a browser started with a
 * debugging port — an installed Chrome has none, and nothing else in the extension's UI can set them.
 */

const status = document.getElementById('status') as HTMLElement;
const fields = Object.fromEntries(
  EDITABLE_KEYS.map((key) => [key, document.getElementById(key) as HTMLInputElement]),
) as Record<(typeof EDITABLE_KEYS)[number], HTMLInputElement>;
const deploymentField = document.getElementById('deployment') as HTMLSelectElement;

function report(message: string): void {
  status.textContent = message;
}

function currentValues(): StoredConfiguration {
  const values = {} as StoredConfiguration;
  for (const key of CONFIGURATION_KEYS) values[key] = fields[key].value.trim();
  if (deploymentField.value) values.deployment = deploymentField.value;
  const applicationId = fields.applicationId.value.trim();
  if (applicationId) values.applicationId = applicationId;
  return values;
}

document.getElementById('extension-id')!.textContent = chrome.runtime.id;

const stored = await readStoredConfiguration(chrome.storage.local, chrome.storage.session);
for (const key of EDITABLE_KEYS) {
  if (typeof stored[key] === 'string') fields[key].value = stored[key];
}
deploymentField.value = typeof stored.deployment === 'string' ? stored.deployment : '';
function applyDeployment(): void {
  const deployment = businessDeployment(deploymentField.value);
  if (deployment) {
    const preset = BUSINESS_DEPLOYMENTS[deployment];
    fields.apiUrl.value = preset.apiUrl;
    fields.issuer.value = preset.issuer;
    fields.clientId.value = BUSINESS_INTERACTIVE_CLIENT_ID;
    fields.environment.value = preset.environment;
    fields.applicationId.value = '';
  }
  for (const key of ['apiUrl', 'issuer', 'clientId', 'applicationId'] as const) fields[key].readOnly = !!deployment;
  if (!deployment) fields.environment.value = 'TEST';
}
applyDeployment();
deploymentField.addEventListener('change', applyDeployment);
if (!fields.environment.value) fields.environment.value = 'TEST';

document.getElementById('apply-paste')!.addEventListener('click', () => {
  const text = (document.getElementById('paste') as HTMLTextAreaElement).value.trim();
  if (!text) return;
  try {
    const values = configurationFromJson(text);
    deploymentField.value = values.deployment ?? '';
    for (const key of CONFIGURATION_KEYS) fields[key].value = values[key];
    fields.applicationId.value = values.applicationId ?? '';
    applyDeployment();
    report('Fields filled — press Save.');
  } catch (error) {
    report(`Could not read that JSON: ${(error as Error).message}`);
  }
});

document.getElementById('save')!.addEventListener('click', async () => {
  try {
    const values = currentValues();
    resolveConfiguration(values);
    await chrome.runtime.sendMessage({ type: 'sign-out' });
    await chrome.storage.session.remove('masterKeySecret');
    await chrome.storage.local.remove(['masterKeyCustody', 'masterKeySalt']);
    await writeStoredConfiguration(chrome.storage.local, values);
    report('Saved. Sign in again for this deployment.');
  } catch (error) {
    report(`Could not save: ${(error as Error).message}`);
  }
});
