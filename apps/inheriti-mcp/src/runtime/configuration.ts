import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  BUSINESS_DEPLOYMENTS,
  BUSINESS_INTERACTIVE_CLIENT_ID,
  businessDeployment,
} from '@safetech/inheriti-elements-core/node-base';
import { coded } from './errors.js';

export const configPath = () => {
  const base = process.env.XDG_CONFIG_HOME ?? resolve(homedir(), '.config');
  const current = resolve(base, 'inheriti', 'config.json');
  const legacy = resolve(base, 'inheriti-elements', 'config.json');
  return existsSync(current) || !existsSync(legacy) ? current : legacy;
};
declare const __INHERITI_PRODUCTION_BUILD__: boolean;
declare const __INHERITI_DEPLOYMENT__: string;
const developmentBuild = typeof __INHERITI_PRODUCTION_BUILD__ !== 'boolean' || !__INHERITI_PRODUCTION_BUILD__;
export const lockedDeployment =
  typeof __INHERITI_DEPLOYMENT__ === 'string' ? businessDeployment(__INHERITI_DEPLOYMENT__) : undefined;

export type Configuration = {
  apiUrl: string;
  issuer: string;
  clientId: string;
  environment: 'TEST' | 'LIVE';
  redirectUri: string;
  deployment?: string;
};
export async function configuration(): Promise<Configuration> {
  if (lockedDeployment) {
    return {
      ...BUSINESS_DEPLOYMENTS[lockedDeployment],
      deployment: lockedDeployment,
      clientId: BUSINESS_INTERACTIVE_CLIENT_ID,
      redirectUri: 'http://127.0.0.1:53682/oauth/callback',
    };
  }
  const raw: unknown = JSON.parse(await readFile(configPath(), 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw coded('configuration_invalid');
  const value = raw as Record<string, unknown>;
  if (value.deployment !== undefined) {
    const deployment = businessDeployment(value.deployment);
    if (!deployment || value.business !== true) throw coded('configuration_invalid');
    if (deployment === 'prod' && developmentBuild) throw coded('live_environment_unavailable_in_development_build');
    return {
      ...BUSINESS_DEPLOYMENTS[deployment],
      deployment,
      clientId: BUSINESS_INTERACTIVE_CLIENT_ID,
      redirectUri: typeof value.redirectUri === 'string' ? value.redirectUri : 'http://127.0.0.1:53682/oauth/callback',
    };
  }
  if (
    typeof value.apiUrl !== 'string' ||
    typeof value.issuer !== 'string' ||
    typeof value.clientId !== 'string' ||
    !['TEST', 'LIVE'].includes(String(value.environment))
  )
    throw coded('configuration_invalid');
  if (value.environment === 'LIVE' && developmentBuild)
    throw coded('live_environment_unavailable_in_development_build');
  return {
    apiUrl: value.apiUrl,
    issuer: value.issuer,
    clientId: value.clientId,
    environment: value.environment as 'TEST' | 'LIVE',
    redirectUri: typeof value.redirectUri === 'string' ? value.redirectUri : 'http://127.0.0.1:53682/oauth/callback',
  };
}
