import { BUSINESS_DEPLOYMENTS } from '../../../../packages/core/src/deployment.js';
import { runProtocol } from './protocol.js';
import { WorkspaceSession } from './session.js';

const deployment = process.argv[2];
if (!deployment || !Object.hasOwn(BUSINESS_DEPLOYMENTS, deployment)) process.exit(2);

runProtocol(process.stdin, process.stdout, new WorkspaceSession(deployment as keyof typeof BUSINESS_DEPLOYMENTS, undefined, process.argv[3]));
