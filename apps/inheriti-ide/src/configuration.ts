import type { ElementsEnvironment } from '@safetech/inheriti-elements-core';
import { BUSINESS_DEPLOYMENTS, BUSINESS_INTERACTIVE_CLIENT_ID, businessDeployment, businessUiRpId } from '@safetech/inheriti-elements-core/node';

export interface ExtensionConfiguration {
  apiUrl: string;
  applicationId?: string;
  business: boolean;
  issuer: string;
  clientId: string;
  environment: ElementsEnvironment;
  redirectUri: string;
  scopes: readonly string[];
  masterKeySalt?: string;
  safeKeyProDevice?: string;
  safeKeyProRpId?: string;
}

export class ExtensionConfigurationInvalid extends Error {
  public constructor(public readonly code: string, detail: string) {
    super(detail);
    this.name = 'ExtensionConfigurationInvalid';
  }
}

/** A development build reaches TEST only, whatever the settings say. */
declare const __INHERITI_PRODUCTION_BUILD__: boolean;
declare const __INHERITI_DEPLOYMENT__: string;
export const IS_DEVELOPMENT_BUILD = typeof __INHERITI_PRODUCTION_BUILD__ !== 'boolean' || !__INHERITI_PRODUCTION_BUILD__;
export const BUILD_DEPLOYMENT = typeof __INHERITI_DEPLOYMENT__ === 'string'
  ? businessDeployment(__INHERITI_DEPLOYMENT__) : undefined;

export const REDIRECT_URI = 'vscode://safetech.inheriti-ide/oauth/callback';
const SCOPES = ['openid', 'plan:list', 'plan:read', 'plan:reveal', 'asset:insert'] as const;

export type SettingsReader = (key: string) => string | undefined;

export function resolveConfiguration(read: SettingsReader): ExtensionConfiguration {
  if (BUILD_DEPLOYMENT) {
    return {
      ...BUSINESS_DEPLOYMENTS[BUILD_DEPLOYMENT],
      business: true,
      clientId: BUSINESS_INTERACTIVE_CLIENT_ID,
      redirectUri: REDIRECT_URI,
      scopes: ['openid'],
      safeKeyProRpId: businessUiRpId(BUILD_DEPLOYMENT),
      ...(read('safeKeyProDevice')?.trim() ? {
        safeKeyProDevice: read('safeKeyProDevice')!.trim(),
      } : {}),
    };
  }
  const deploymentValue = read('deployment');
  const deployment = deploymentValue ? businessDeployment(deploymentValue) : undefined;
  if (deploymentValue && !deployment) throw new ExtensionConfigurationInvalid('deployment_invalid', `Unknown deployment ${deploymentValue}.`);
  if (deployment && read('applicationId')?.trim()) {
    throw new ExtensionConfigurationInvalid('configuration_conflict', 'Business deployment requires a blank Application id.');
  }
  const preset = deployment ? BUSINESS_DEPLOYMENTS[deployment] : undefined;
  const environment = readEnvironment(preset?.environment ?? read('environment'));
  if (environment === 'LIVE' && IS_DEVELOPMENT_BUILD) {
    throw new ExtensionConfigurationInvalid(
      'live_environment_unavailable_in_development_build',
      'This build supports TEST only. A production build is required for LIVE.',
    );
  }
  return {
    apiUrl: preset?.apiUrl ?? required(read, 'apiUrl'),
    ...(read('applicationId')?.trim() ? { applicationId: read('applicationId')!.trim() } : {}),
    business: !read('applicationId')?.trim(),
    issuer: preset?.issuer ?? required(read, 'issuer'),
    clientId: preset ? BUSINESS_INTERACTIVE_CLIENT_ID : required(read, 'clientId'),
    environment,
    redirectUri: REDIRECT_URI,
    scopes: read('applicationId')?.trim() ? SCOPES : ['openid'],
    ...(read('masterKeySalt')?.trim() ? { masterKeySalt: read('masterKeySalt')!.trim() } : {}),
    ...(deployment ? { safeKeyProRpId: businessUiRpId(deployment) } : {}),
    ...(read('safeKeyProDevice')?.trim() ? { safeKeyProDevice: read('safeKeyProDevice')!.trim() } : {}),
  };
}

function readEnvironment(value: string | undefined): ElementsEnvironment {
  if (value === undefined || value === '' || value === 'TEST') return 'TEST';
  if (value === 'LIVE') return 'LIVE';
  throw new ExtensionConfigurationInvalid('environment_invalid', `Unknown environment ${value}. Use TEST or LIVE.`);
}

function required(read: SettingsReader, key: string): string {
  const value = read(key)?.trim();
  if (!value) {
    throw new ExtensionConfigurationInvalid(
      'configuration_missing',
      `Set ${key} in Inheriti settings before signing in.`,
    );
  }
  return value;
}
