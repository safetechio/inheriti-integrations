import {
  HttpOperatorAuthTransport,
  OperatorAuthClient,
  SystemOAuthClock,
  WebOAuthCrypto,
} from '@safetech/inheriti-client-sdk/browser';
import type { OperatorAuthFacade } from './index.js';
import { composeOperatorAuth } from './operator-auth.js';
import type { OperatorAuthOptions } from './operator-auth.js';

/**
 * Operator auth for a bundled host (Chrome, VS Code). Uses the SDK's React-free `/browser` entry,
 * which a bundler resolves without pulling a UI framework; a plain Node host must use
 * `@safetech/inheriti-elements-core/node` instead.
 */
export function createOperatorAuth(options: OperatorAuthOptions): OperatorAuthFacade {
  return composeOperatorAuth({ OperatorAuthClient, HttpOperatorAuthTransport, SystemOAuthClock, WebOAuthCrypto }, options);
}

export type { OperatorAuthOptions } from './operator-auth.js';
