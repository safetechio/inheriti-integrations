import { createPrivateKey, randomBytes, sign } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { AutomationProviderValue } from '@safetech/inheriti-elements-core/node-base';
import { awsAutomationProof } from './aws-automation-proof.js';

type Environment = Readonly<Record<string, string | undefined>>;
type JobRequest = (path: string, credential: string | undefined, body?: object) => Promise<unknown>;
type Transport = typeof fetch;

abstract class AutomationIdentity {
  abstract complete(environment: Environment): boolean;
  abstract proof(connectionId: string, audience: string | undefined, environment: Environment,
    transport: Transport, jobRequest: JobRequest): Promise<string>;
  validate(connectionId: string | undefined, audience: string | undefined, environment: Environment): void {
    if (!connectionId || (this.needsAudience && !audience)) throw new Error('automation_configuration_required');
    this.validateProvider(connectionId, audience, environment);
  }
  protected get needsAudience(): boolean { return true; }
  protected abstract validateProvider(connectionId: string, audience: string | undefined, environment: Environment): void;
}

class GithubIdentity extends AutomationIdentity {
  complete(environment: Environment): boolean {
    return Boolean(environment.INHERITI_AUTOMATION_AUDIENCE && environment.ACTIONS_ID_TOKEN_REQUEST_URL && environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
  }
  protected validateProvider(_connectionId: string, _audience: string | undefined, environment: Environment): void {
    if (!environment.ACTIONS_ID_TOKEN_REQUEST_URL || !environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN)
      throw new Error('automation_github_configuration_required');
    const url = new URL(environment.ACTIONS_ID_TOKEN_REQUEST_URL);
    if (url.protocol !== 'https:' || !(url.hostname === 'actions.githubusercontent.com' || url.hostname.endsWith('.actions.githubusercontent.com')))
      throw new Error('automation_github_oidc_url_invalid');
  }
  async proof(_connectionId: string, audience: string | undefined, environment: Environment, transport: Transport): Promise<string> {
    const url = new URL(environment.ACTIONS_ID_TOKEN_REQUEST_URL!);
    url.searchParams.set('audience', audience!);
    const response = await transport(url, { headers: { authorization: `Bearer ${environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
    if (!response.ok) throw new Error('automation_github_proof_rejected');
    const body: unknown = await response.json();
    if (!isRecord(body) || typeof body.value !== 'string' || !body.value) throw new Error('automation_github_proof_invalid');
    return body.value;
  }
}

class GoogleCloudIdentity extends AutomationIdentity {
  complete(environment: Environment): boolean { return Boolean(environment.INHERITI_AUTOMATION_AUDIENCE); }
  protected validateProvider(connectionId: string, audience: string | undefined): void {
    if (!audience!.endsWith(`/${connectionId}`)) throw new Error('automation_google_audience_invalid');
  }
  async proof(_connectionId: string, audience: string | undefined, _environment: Environment, transport: Transport): Promise<string> {
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
}

class AwsIdentity extends AutomationIdentity {
  protected override get needsAudience(): boolean { return false; }
  complete(environment: Environment): boolean { return Boolean(environment.AWS_REGION || environment.AWS_DEFAULT_REGION); }
  protected validateProvider(_connectionId: string, _audience: string | undefined, environment: Environment): void {
    if (!this.complete(environment)) throw new Error('automation_aws_region_required');
  }
  async proof(connectionId: string, _audience: string | undefined, environment: Environment,
    transport: Transport, jobRequest: JobRequest): Promise<string> {
    const value = await jobRequest('automation/jobs/aws-challenge', undefined, { connectionId });
    if (!isRecord(value) || typeof value.challenge !== 'string' || !value.challenge ||
        typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) ||
        Date.parse(value.expiresAt) <= Date.now())
      throw new Error('automation_aws_challenge_invalid');
    return awsAutomationProof(value.challenge, environment.AWS_REGION || environment.AWS_DEFAULT_REGION!, environment, transport);
  }
}

class PortableIdentity extends AutomationIdentity {
  protected override get needsAudience(): boolean { return false; }
  complete(environment: Environment): boolean {
    return Boolean(environment.INHERITI_AUTOMATION_KEY_ID && environment.INHERITI_AUTOMATION_RUNNER_SUBJECT &&
      environment.INHERITI_AUTOMATION_ENVIRONMENT && environment.INHERITI_AUTOMATION_PRIVATE_KEY_FILE);
  }
  protected validateProvider(connectionId: string, audience: string | undefined, environment: Environment): void {
    if (!this.complete(environment) || (audience && audience !== AutomationProviderValue.from('PORTABLE').expectedAudience(connectionId)))
      throw new Error('automation_portable_configuration_required');
  }
  async proof(connectionId: string, _audience: string | undefined, environment: Environment): Promise<string> {
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
        aud: AutomationProviderValue.from('PORTABLE').expectedAudience(connectionId),
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
}

const github = new GithubIdentity();
const providers: Readonly<Record<string, AutomationIdentity>> = {
  GOOGLE_CLOUD: new GoogleCloudIdentity(),
  AWS: new AwsIdentity(),
  PORTABLE: new PortableIdentity(),
};

export function automationIdentity(provider: string | undefined): AutomationIdentity {
  if (!provider) return github;
  const identity = Object.prototype.hasOwnProperty.call(providers, provider) ? providers[provider] : undefined;
  if (!identity) throw new Error('automation_provider_invalid');
  return identity;
}

export function automationConfigurationComplete(environment: Environment): boolean {
  const provider = environment.INHERITI_AUTOMATION_PROVIDER;
  if (provider && !Object.prototype.hasOwnProperty.call(providers, provider)) return false;
  return Boolean(environment.INHERITI_AUTOMATION_CONNECTION_ID &&
    (provider ? providers[provider] : github)?.complete(environment));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
