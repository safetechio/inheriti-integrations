import type { SecretRevealContext } from './session.js';
import { automationIdentity } from './automation-identity.js';

export { automationConfigurationComplete } from './automation-identity.js';

type Transport = typeof fetch;

/** Verify a pending connection from inside the configured workload. */
export async function pairAutomationIdentity(
  apiUrl: string,
  environment: Readonly<Record<string, string | undefined>>,
  transport: Transport = fetch,
): Promise<void> {
  const connectionId = environment.INHERITI_AUTOMATION_CONNECTION_ID;
  const audience = environment.INHERITI_AUTOMATION_AUDIENCE;
  if (!connectionId) throw new Error('automation_pairing_configuration_required');
  const identity = automationIdentity(environment.INHERITI_AUTOMATION_PROVIDER);
  identity.validate(connectionId, audience, environment);
  const root = `${new URL(apiUrl).origin}/`;
  const jobRequest = async (path: string, _credential: string | undefined, body?: object): Promise<unknown> => {
    const response = await transport(new URL(path, root), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('automation_pairing_failed');
    const value: unknown = await response.json();
    if (!isRecord(value) || value.ok !== true) throw new Error('automation_pairing_failed');
    return value.result;
  };
  const proof = await identity.proof(connectionId, audience, environment, transport, jobRequest);
  await jobRequest('integrations/v1/automation-identity-pairings/redeem', undefined, { connectionId, proof });
}

export function automationSecretsRequested(environment: Readonly<Record<string, string | undefined>>): boolean {
  return Boolean(environment.INHERITI_AUTOMATION_PROVIDER || environment.INHERITI_AUTOMATION_CONNECTION_ID || environment.INHERITI_AUTOMATION_AUDIENCE || environment.INHERITI_AUTOMATION_PRIVATE_KEY_FILE);
}

/** Credentials and GitHub proof exist only for this invocation. */
export async function withAutomationSecrets<T>(
  apiUrl: string,
  environment: Readonly<Record<string, string | undefined>>,
  work: (context: SecretRevealContext) => Promise<T>,
  transport: Transport = fetch,
): Promise<T> {
  const connectionId = environment.INHERITI_AUTOMATION_CONNECTION_ID;
  const audience = environment.INHERITI_AUTOMATION_AUDIENCE;
  const identity = automationIdentity(environment.INHERITI_AUTOMATION_PROVIDER);
  identity.validate(connectionId, audience, environment);
  const automationApiUrl = `${new URL(apiUrl).origin}/`;
  let bearer: string | undefined;
  let expiresAt = 0;
  let renewing: Promise<void> | undefined;
  const jobRequest = async (path: string, credential: string | undefined, body?: object): Promise<unknown> => {
    const response = await transport(new URL(path, automationApiUrl), {
      method: 'POST',
      headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error('automation_job_denied');
    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.ok !== true) throw new Error('automation_job_denied');
    return payload.result;
  };
  const proof = (): Promise<string> => identity.proof(connectionId!, audience, environment, transport, jobRequest);
  const accept = (value: unknown): void => {
    if (!isRecord(value) || typeof value.sessionToken !== 'string' || !value.sessionToken || typeof value.expiresAt !== 'string')
      throw new Error('automation_job_response_invalid');
    const expiry = Date.parse(value.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('automation_job_response_invalid');
    bearer = value.sessionToken;
    expiresAt = expiry;
  };
  try {
    accept(await jobRequest('automation/jobs', undefined, { connectionId, proof: await proof() }));
    const getBearerToken = async (): Promise<string> => {
      if (!bearer) throw new Error('automation_job_missing');
      if (Date.now() + 30_000 >= expiresAt) {
        const pending = renewing ??= (async () => { accept(await jobRequest('automation/jobs/renew', bearer, { proof: await proof() })); })();
        try { await pending; } finally { if (renewing === pending) renewing = undefined; }
      }
      return bearer;
    };
    const { createNodeAutomationRevealClient } = await import('@safetech/inheriti-elements-core/node-base');
    const client = createNodeAutomationRevealClient({ apiUrl: automationApiUrl, getBearerToken, transport });
    const context: SecretRevealContext = {
      keyOwner: 'Organisation',
      core: {
        getAccessToken: getBearerToken,
        getPlan: client.getPlan,
        async withReveal(planId, options, workReveal) {
          const reveal = await client.openReveal(planId, options);
          try {
            const result = await workReveal(reveal);
            await reveal.close('COMPLETED');
            return result;
          } catch (error) {
            await reveal.close(options.signal?.aborted ? 'CANCELED' : 'ERROR');
            throw error;
          }
        },
      },
    };
    return await work(context);
  } finally {
    if (bearer) {
      try { await jobRequest('automation/jobs/end', bearer); }
      catch { /* The job expires server-side; never mask the reveal result or print a credential. */ }
    }
    bearer = undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
