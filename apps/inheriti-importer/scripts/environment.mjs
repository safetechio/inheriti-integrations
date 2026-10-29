import { spawn } from 'node:child_process';
import { loadEnv } from 'vite';

export const environments = ['dev', 'stg', 'prod'];
export const runtimeEnvironmentKeys = [
  'INHERITI_API_ORIGIN',
  'SAFEID_URL',
  'SAFEID_REALM',
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
    SAFEID_URL: values.SAFEID_URL,
    SAFEID_REALM: values.SAFEID_REALM,
    WEB_APP_URL: values.WEB_APP_URL,
  };
}

export function runYarn(args, options = {}) {
  const command = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`yarn ${args.join(' ')} failed (${signal || code})`));
    });
  });
}
