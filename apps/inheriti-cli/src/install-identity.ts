import { existsSync, readFileSync } from 'node:fs';

export function cliCommandForPackage(name: unknown): 'inheriti' | 'inheriti-dev' | 'inheriti-stg' {
  if (name === '@safetech/inheriti-cli-dev') return 'inheriti-dev';
  if (name === '@safetech/inheriti-cli-stg') return 'inheriti-stg';
  return 'inheriti';
}

const manifest = new URL('../package.json', import.meta.url);
export const CLI_COMMAND = cliCommandForPackage(existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).name : undefined);
