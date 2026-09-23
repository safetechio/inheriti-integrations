import { BUSINESS_DEPLOYMENTS } from '@safetech/inheriti-elements-core/node';
import { TraySession } from './modules/launcher/main/state.js';
import type { Deployment } from './modules/launcher/main/state.js';
import { registerAppEvents } from './modules/launcher/main/app.js';
import { trayMessages as messages } from './messages.js';

const deployment = process.env.INHERITI_DEPLOYMENT ?? process.env.INHERITI_BUSINESS_DEPLOYMENT ?? 'dev';
if (!Object.hasOwn(BUSINESS_DEPLOYMENTS, deployment)) {
  throw new Error(messages.invalidDeployment);
}
const appUrls: Record<Deployment, string | undefined> = {
  dev: 'https://business-dev.inheriti.com',
  stg: 'https://business-stg.inheriti.com',
  prod: 'https://business.inheriti.com',
  local: undefined,
};
const appUrl = process.env.INHERITI_APP_URL ?? process.env.INHERITI_BUSINESS_URL ?? appUrls[deployment as Deployment];
if (appUrl && !/^https:\/\//u.test(appUrl) && !/^http:\/\/localhost(?::\d+)?$/u.test(appUrl)) {
  throw new Error(messages.invalidAppUrl);
}
registerAppEvents(new TraySession(deployment as Deployment), appUrl);
