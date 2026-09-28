import { buildDefines, requiredBuildDeployment } from './build-deployment.mjs';

export function chromeBuildOptions(argv = process.argv.slice(2), environment = process.env) {
  const harness = argv.includes('--harness');
  const deployment = requiredBuildDeployment(argv, environment);
  if (harness && deployment !== 'local') throw new Error('--harness requires --deployment=local.');
  const defines = buildDefines(argv, environment);
  if (harness) delete defines.__INHERITI_DEPLOYMENT__;
  return { harness, defines };
}
