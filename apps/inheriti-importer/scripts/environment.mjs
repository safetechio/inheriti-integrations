import { spawn } from 'node:child_process';
import { loadEnv } from 'vite';

export const environments = ['dev', 'stg', 'prod'];
export const runtimeEnvironmentKeys = [
  'INHERITI_API_ORIGIN',
  'KEYCLOAK_URL',
  'KEYCLOAK_CLIENT_ID',
  'KEYCLOAK_REALM',
  'WEB_APP_URL',
];

export function assertEnvironment(environment) {
  if (environments.includes(environment)) return;
  throw new Error(`Environment must be one of: ${environments.join(', ')}`);
}

export function readEnvironment(environment, root) {
  assertEnvironment(environment);
  const values = loadEnv(environment, root, '');
  const missing = runtimeEnvironmentKeys.filter((key) => !values[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required variables in .env.${environment}: ${missing.join(', ')}`);
  }

  return {
    environment,
    INHERITI_API_ORIGIN: values.INHERITI_API_ORIGIN,
    KEYCLOAK_URL: values.KEYCLOAK_URL,
    KEYCLOAK_CLIENT_ID: values.KEYCLOAK_CLIENT_ID,
    KEYCLOAK_REALM: values.KEYCLOAK_REALM,
    WEB_APP_URL: values.WEB_APP_URL,
  };
}

export function runPnpm(args, options = {}) {
  const pnpmPath = process.env.npm_execpath;
  const command = pnpmPath ? process.execPath : process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
  const commandArgs = pnpmPath ? [pnpmPath, ...args] : ['pnpm', ...args];
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd,
      env: options.env || process.env,
      shell: !pnpmPath && process.platform === 'win32',
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`pnpm ${args.join(' ')} failed (${signal || code})`));
    });
  });
}
