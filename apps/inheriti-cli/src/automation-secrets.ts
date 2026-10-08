import type { SecretRevealContext } from './session.js';
import { createPrivateKey, randomBytes, sign } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { awsAutomationProof } from './aws-automation-proof.js';

type Transport = typeof fetch;

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
  const google = environment.INHERITI_AUTOMATION_PROVIDER === 'GOOGLE_CLOUD';
  const portable = environment.INHERITI_AUTOMATION_PROVIDER === 'PORTABLE';
  const aws = environment.INHERITI_AUTOMATION_PROVIDER === 'AWS';
  if (environment.INHERITI_AUTOMATION_PROVIDER && !google && !portable && !aws) throw new Error('automation_provider_invalid');
  const requestUrl = environment.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!connectionId || (!portable && !aws && !audience)) throw new Error('automation_configuration_required');
  if (aws && !environment.AWS_REGION && !environment.AWS_DEFAULT_REGION) throw new Error('automation_aws_region_required');
  if (portable && (!environment.INHERITI_AUTOMATION_KEY_ID || !environment.INHERITI_AUTOMATION_RUNNER_SUBJECT ||
      !environment.INHERITI_AUTOMATION_ENVIRONMENT || !environment.INHERITI_AUTOMATION_PRIVATE_KEY_FILE ||
      (audience && audience !== `urn:inheriti:automation:connection:${connectionId}`)))
    throw new Error('automation_portable_configuration_required');
  if (google && !audience!.endsWith(`/${connectionId}`)) throw new Error('automation_google_audience_invalid');
  if (!google && !portable && !aws && (!requestUrl || !requestToken)) throw new Error('automation_github_configuration_required');
  const oidcUrl = google || portable || aws ? undefined : new URL(requestUrl!);
  if (oidcUrl && (oidcUrl.protocol !== 'https:' || !(oidcUrl.hostname === 'actions.githubusercontent.com' || oidcUrl.hostname.endsWith('.actions.githubusercontent.com'))))
    throw new Error('automation_github_oidc_url_invalid');
  let bearer: string | undefined;
  let expiresAt = 0;
  let renewing: Promise<void> | undefined;
  const proof = async (): Promise<string> => {
    if (aws) {
      const value = await jobRequest('automation/jobs/aws-challenge', undefined, { connectionId });
      if (!isRecord(value) || typeof value.challenge !== 'string' || !value.challenge ||
          typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) ||
          Date.parse(value.expiresAt) <= Date.now())
        throw new Error('automation_aws_challenge_invalid');
      return awsAutomationProof(value.challenge, environment.AWS_REGION || environment.AWS_DEFAULT_REGION!, environment, transport);
    }
    if (portable) return portableAssertion(connectionId, environment);
    if (google) {
      const url = new URL('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity');
      url.searchParams.set('audience', audience!);
      const response = await transport(url, { headers: { 'Metadata-Flavor': 'Google' }, redirect: 'error', signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error('automation_google_proof_rejected');
      if (Number(response.headers.get('content-length')) > 16_384) throw new Error('automation_google_proof_invalid');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('automation_google_proof_invalid');
      const bytes = new Uint8Array(16_384);
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (length + value.length > bytes.length) {
          await reader.cancel();
          throw new Error('automation_google_proof_invalid');
        }
        bytes.set(value, length);
        length += value.length;
      }
      const token = new TextDecoder().decode(bytes.subarray(0, length));
      if (!token) throw new Error('automation_google_proof_invalid');
      return token;
    }
    const url = new URL(oidcUrl!);
    url.searchParams.set('audience', audience!);
    const response = await transport(url, { headers: { authorization: `Bearer ${requestToken}` } });
    if (!response.ok) throw new Error('automation_github_proof_rejected');
    const body: unknown = await response.json();
    if (!isRecord(body) || typeof body.value !== 'string' || !body.value) throw new Error('automation_github_proof_invalid');
    return body.value;
  };
  const jobRequest = async (path: string, credential: string | undefined, body?: object): Promise<unknown> => {
    const response = await transport(new URL(path, apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`), {
      method: 'POST',
      headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error('automation_job_denied');
    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.ok !== true) throw new Error('automation_job_denied');
    return payload.result;
  };
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
    const client = createNodeAutomationRevealClient({ apiUrl, getBearerToken, transport });
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

async function portableAssertion(connectionId: string, environment: Readonly<Record<string, string | undefined>>): Promise<string> {
  if (process.platform === 'win32') throw new Error('automation_portable_key_permissions_unavailable');
  const path = environment.INHERITI_AUTOMATION_PRIVATE_KEY_FILE!;
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer | undefined;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096 ||
        (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
      throw new Error('automation_portable_key_permissions_invalid');
    bytes = await file.readFile();
    const key = createPrivateKey(bytes);
    if (key.asymmetricKeyType !== 'ed25519' ||
        key.export({ type: 'pkcs8', format: 'pem' }).toString() !== bytes.toString())
      throw new Error('automation_portable_key_invalid');
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: environment.INHERITI_AUTOMATION_KEY_ID })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({
      iss: 'urn:inheriti:automation:portable',
      aud: `urn:inheriti:automation:connection:${connectionId}`,
      sub: environment.INHERITI_AUTOMATION_RUNNER_SUBJECT,
      environment: environment.INHERITI_AUTOMATION_ENVIRONMENT,
      jti: randomBytes(24).toString('base64url'), iat: now, exp: now + 120,
    })).toString('base64url');
    const signed = `${header}.${claims}`;
    return `${signed}.${sign(null, Buffer.from(signed), key).toString('base64url')}`;
  } finally {
    bytes?.fill(0);
    await file.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
