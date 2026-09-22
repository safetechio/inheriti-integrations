import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEPLOYMENTS = new Set(['local', 'dev', 'stg', 'prod']);
const MARKER = 'build-deployment.json';

export function buildDeployment(argv = process.argv.slice(2), environment = process.env) {
  const argument = argv.find((value) => value.startsWith('--deployment='))?.slice('--deployment='.length);
  const deployment = argument ?? environment.INHERITI_BUILD_DEPLOYMENT;
  if (deployment !== undefined && !DEPLOYMENTS.has(deployment)) {
    throw new Error(`Unknown build deployment: ${deployment}. Use local, dev, stg, or prod.`);
  }
  return deployment;
}

export function requiredBuildDeployment(argv = process.argv.slice(2), environment = process.env) {
  const deployment = buildDeployment(argv, environment);
  if (deployment === undefined) {
    throw new Error('A packaged artifact requires INHERITI_BUILD_DEPLOYMENT=local|dev|stg|prod.');
  }
  return deployment;
}

export async function writeBuildDeployment(directory, argv = process.argv.slice(2), environment = process.env) {
  await writeFile(resolve(directory, MARKER), `${JSON.stringify({ deployment: buildDeployment(argv, environment) ?? null })}\n`);
}

export async function matchingBuildDeployment(root, argv = process.argv.slice(2), environment = process.env) {
  const deployment = requiredBuildDeployment(argv, environment);
  let built;
  try {
    built = JSON.parse(await readFile(resolve(root, 'dist', MARKER), 'utf8')).deployment;
  } catch {
    throw new Error('The compiled artifact has no deployment lock. Rebuild it before packaging.');
  }
  if (built !== deployment) {
    throw new Error(`The compiled artifact is locked to ${String(built)}, not ${deployment}. Rebuild it before packaging.`);
  }
  return deployment;
}

export function buildDefines(argv = process.argv.slice(2), environment = process.env) {
  const deployment = buildDeployment(argv, environment);
  const production = deployment === undefined ? argv.includes('--production') : deployment === 'prod';
  return {
    __INHERITI_PRODUCTION_BUILD__: String(production),
    ...(deployment === undefined ? {} : { __INHERITI_DEPLOYMENT__: JSON.stringify(deployment) }),
  };
}
