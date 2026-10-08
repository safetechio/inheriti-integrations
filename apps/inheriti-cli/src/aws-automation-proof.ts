import { createHmac, createHash } from 'node:crypto';

type Transport = typeof fetch;
type Credentials = { AccessKeyId: string; SecretAccessKey: string; Token: string; Expiration: string };

const stsBody = 'Action=GetCallerIdentity&Version=2011-06-15';
const contentType = 'application/x-www-form-urlencoded; charset=utf-8';

export async function awsAutomationProof(
  challenge: string,
  region: string,
  environment: Readonly<Record<string, string | undefined>>,
  transport: Transport,
): Promise<string> {
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)) throw new Error('automation_aws_region_invalid');
  const credentials = await roleCredentials(environment, transport);
  if (!credentials.AccessKeyId.startsWith('ASIA') || !credentials.SecretAccessKey || !credentials.Token ||
      !Number.isFinite(Date.parse(credentials.Expiration)) || Date.parse(credentials.Expiration) <= Date.now() + 60_000)
    throw new Error('automation_aws_role_credentials_required');
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = date.slice(0, 8);
  const host = `sts.${region}.amazonaws.com`;
  const signedHeaders = 'content-type;host;x-amz-date;x-amz-security-token;x-inheriti-aws-challenge';
  const headers = `content-type:${contentType}\nhost:${host}\nx-amz-date:${date}\nx-amz-security-token:${credentials.Token}\nx-inheriti-aws-challenge:${challenge}\n`;
  const canonical = `POST\n/\n\n${headers}\n${signedHeaders}\n${hash(stsBody)}`;
  const scope = `${day}/${region}/sts/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`;
  const hmac = (key: Buffer, value: string): Buffer => createHmac('sha256', key).update(value).digest();
  const key = hmac(hmac(hmac(hmac(Buffer.from(`AWS4${credentials.SecretAccessKey}`), day), region), 'sts'), 'aws4_request');
  const signature = createHmac('sha256', key).update(stringToSign).digest('hex');
  return JSON.stringify({
    challenge, region, date, securityToken: credentials.Token,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  });
}

function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }

async function roleCredentials(environment: Readonly<Record<string, string | undefined>>, transport: Transport): Promise<Credentials> {
  const relative = environment.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  let url: URL;
  let headers: Record<string, string> = {};
  if (relative) {
    if (!/^\/(?!\/)[A-Za-z0-9/_-]+$/.test(relative)) throw new Error('automation_aws_role_credentials_required');
    url = new URL(relative, 'http://169.254.170.2');
    if (url.origin !== 'http://169.254.170.2') throw new Error('automation_aws_role_credentials_required');
  } else {
    const tokenResponse = await transport('http://169.254.169.254/latest/api/token', {
      method: 'PUT', headers: { 'x-aws-ec2-metadata-token-ttl-seconds': '60' }, redirect: 'error', signal: AbortSignal.timeout(3_000),
    });
    if (!tokenResponse.ok) throw new Error('automation_aws_role_credentials_required');
    const token = await boundedText(tokenResponse, 4096);
    if (!token || token.length > 4096) throw new Error('automation_aws_role_credentials_required');
    headers = { 'x-aws-ec2-metadata-token': token };
    const rolesResponse = await transport('http://169.254.169.254/latest/meta-data/iam/security-credentials/', {
      headers, redirect: 'error', signal: AbortSignal.timeout(3_000),
    });
    if (!rolesResponse.ok) throw new Error('automation_aws_role_credentials_required');
    const role = (await boundedText(rolesResponse, 128)).trim();
    if (!/^[A-Za-z0-9+=,.@_-]{1,128}$/.test(role)) throw new Error('automation_aws_role_credentials_required');
    url = new URL(`http://169.254.169.254/latest/meta-data/iam/security-credentials/${role}`);
  }
  const response = await transport(url, { headers, redirect: 'error', signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error('automation_aws_role_credentials_required');
  const value: unknown = JSON.parse(await boundedText(response, 16_384));
  if (!value || typeof value !== 'object') throw new Error('automation_aws_role_credentials_required');
  const record = value as Record<string, unknown>;
  if (typeof record.AccessKeyId !== 'string' || typeof record.SecretAccessKey !== 'string' ||
      typeof record.Token !== 'string' || typeof record.Expiration !== 'string')
    throw new Error('automation_aws_role_credentials_required');
  return record as Credentials;
}

async function boundedText(response: Response, limit: number): Promise<string> {
  if (Number(response.headers.get('content-length')) > limit) throw new Error('automation_aws_role_credentials_required');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('automation_aws_role_credentials_required');
  const bytes = new Uint8Array(limit);
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.length > limit) {
      await reader.cancel();
      throw new Error('automation_aws_role_credentials_required');
    }
    bytes.set(value, length);
    length += value.length;
  }
  return new TextDecoder().decode(bytes.subarray(0, length));
}
