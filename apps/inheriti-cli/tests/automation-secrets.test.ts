import { describe, expect, it, vi } from 'vitest';
import { withAutomationSecrets } from '../src/automation-secrets.js';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const clientFactory = vi.hoisted(() => vi.fn());
vi.mock('@safetech/inheriti-elements-core/node-base', () => ({ createNodeAutomationRevealClient: clientFactory }));

const environment = {
  INHERITI_AUTOMATION_CONNECTION_ID: 'connection-1',
  INHERITI_AUTOMATION_AUDIENCE: 'inheriti-business',
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.githubusercontent.com/oidc',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'github-request-token',
};

describe('GitHub automation secret session', () => {
  it('keeps credentials in memory, renews with a fresh proof, and ends the job', async () => {
    const paths: string[] = [];
    const bodies: unknown[] = [];
    let proofNumber = 0;
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      bodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
      if (url.hostname === 'token.actions.githubusercontent.com')
        return Response.json({ value: `proof-${++proofNumber}` });
      if (url.pathname.endsWith('/end')) return Response.json({ ok: true });
      return Response.json({ ok: true, result: {
        sessionToken: paths.some((path) => path.endsWith('/renew')) ? 'second-token' : 'first-token',
        expiresAt: new Date(Date.now() + (paths.some((path) => path.endsWith('/renew')) ? 120_000 : 15_000)).toISOString(),
      } });
    });
    clientFactory.mockImplementation(({ getBearerToken }) => ({ getPlan: vi.fn(), openReveal: vi.fn(), getBearerToken }));
    await withAutomationSecrets('https://business.example/api', environment, async (context) => {
      expect(await Promise.all([context.core.getAccessToken(), context.core.getAccessToken()]))
        .toEqual(['second-token', 'second-token']);
    }, transport);
    expect(paths).toEqual(['/oidc', '/api/automation/jobs', '/oidc', '/api/automation/jobs/renew', '/api/automation/jobs/end']);
    expect(bodies[1]).toEqual({ connectionId: 'connection-1', proof: 'proof-1' });
    expect(bodies[3]).toEqual({ proof: 'proof-2' });
    expect(JSON.stringify(bodies)).not.toContain('github-request-token');
  });

  it('ends a started job after a failed reveal and never includes proof or bearer in the error', async () => {
    const paths: string[] = [];
    const transport = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      return url.hostname === 'token.actions.githubusercontent.com'
        ? Response.json({ value: 'private-proof' })
        : url.pathname.endsWith('/end') ? Response.json({ ok: true })
          : Response.json({ ok: true, result: { sessionToken: 'private-bearer', expiresAt: new Date(Date.now() + 120_000).toISOString() } });
    });
    clientFactory.mockReturnValue({ getPlan: vi.fn(), openReveal: vi.fn() });
    await expect(withAutomationSecrets('https://business.example/api', environment, async () => { throw new Error('denied'); }, transport)).rejects.toThrow('denied');
    expect(paths.at(-1)).toBe('/api/automation/jobs/end');
  });

  it('does not create a client or job when GitHub identity is incomplete', async () => {
    clientFactory.mockClear();
    const transport = vi.fn();
    await expect(withAutomationSecrets('https://business.example/api', { ...environment, ACTIONS_ID_TOKEN_REQUEST_TOKEN: undefined }, async () => 0, transport)).rejects.toThrow('automation_github_configuration_required');
    expect(transport).not.toHaveBeenCalled();
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('closes a failed reveal as ERROR before ending the job', async () => {
    const close = vi.fn(async () => undefined);
    clientFactory.mockReturnValue({ getPlan: vi.fn(), openReveal: vi.fn(async () => ({ close })) });
    const transport = vi.fn(async (input: RequestInfo | URL) =>
      new URL(String(input)).hostname === 'token.actions.githubusercontent.com'
        ? Response.json({ value: 'proof' })
        : Response.json({ ok: true, result: { sessionToken: 'bearer', expiresAt: new Date(Date.now() + 120_000).toISOString() } }));
    await expect(withAutomationSecrets('https://business.example/api', environment,
      (context) => context.core.withReveal('plan-1', {}, async () => { throw new Error('action denied'); }), transport)).rejects.toThrow('action denied');
    expect(close).toHaveBeenCalledWith('ERROR');
  });
});

describe('portable automation secret session', () => {
  it('signs fresh EdDSA assertions for the API contract on start and renew', async () => {
    if (process.platform === 'win32') return;
    const directory = await mkdtemp(join(tmpdir(), 'inheriti-portable-test-'));
    try {
      const keys = generateKeyPairSync('ed25519');
      const path = join(directory, 'private.pem');
      await writeFile(path, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
      const portableEnvironment = { INHERITI_AUTOMATION_PROVIDER: 'PORTABLE',
        INHERITI_AUTOMATION_CONNECTION_ID: 'connection-1', INHERITI_AUTOMATION_KEY_ID: 'key_1',
        INHERITI_AUTOMATION_PRIVATE_KEY_FILE: path, INHERITI_AUTOMATION_RUNNER_SUBJECT: 'controller-1',
        INHERITI_AUTOMATION_ENVIRONMENT: 'prod' };
      const proofs: string[] = [];
      const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/end')) return Response.json({ ok: true });
        const body = JSON.parse(String(init?.body));
        proofs.push(body.proof);
        return Response.json({ ok: true, result: { sessionToken: 'bearer',
          expiresAt: new Date(Date.now() + (proofs.length === 1 ? 15_000 : 120_000)).toISOString() } });
      });
      clientFactory.mockImplementation(({ getBearerToken }) => ({ getPlan: vi.fn(), openReveal: vi.fn(), getBearerToken }));
      await withAutomationSecrets('https://business.example/api', portableEnvironment,
        async (context) => { await context.core.getAccessToken(); }, transport);
      expect(proofs).toHaveLength(2);
      for (const proof of proofs) {
        const [header, claims, signature] = proof.split('.');
        expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'EdDSA', typ: 'JWT', kid: 'key_1' });
        expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toMatchObject({
          iss: 'urn:inheriti:automation:portable', aud: 'urn:inheriti:automation:connection:connection-1',
          sub: 'controller-1', environment: 'prod',
        });
        expect(verify(null, Buffer.from(`${header}.${claims}`), keys.publicKey, Buffer.from(signature!, 'base64url'))).toBe(true);
      }
      expect(proofs[0]).not.toBe(proofs[1]);
      await chmod(path, 0o644);
      await expect(withAutomationSecrets('https://business.example/api', portableEnvironment,
        async () => 0, transport)).rejects.toThrow('automation_portable_key_permissions_invalid');
      await expect(withAutomationSecrets('https://business.example/api', { ...portableEnvironment,
        INHERITI_AUTOMATION_KEY_ID: undefined }, async () => 0, transport))
        .rejects.toThrow('automation_portable_configuration_required');
      expect(proofs).toHaveLength(2);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe('Google Cloud automation secret session', () => {
  const googleEnvironment = {
    INHERITI_AUTOMATION_PROVIDER: 'GOOGLE_CLOUD',
    INHERITI_AUTOMATION_CONNECTION_ID: 'connection-1',
    INHERITI_AUTOMATION_AUDIENCE: 'https://business.example/automation/connection-1',
  };

  it('uses fresh metadata identity tokens for start and renew', async () => {
    const paths: string[] = [];
    const bodies: unknown[] = [];
    let proofNumber = 0;
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      bodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
      if (url.hostname === 'metadata.google.internal') {
        expect(init?.headers).toEqual({ 'Metadata-Flavor': 'Google' });
        expect(init?.redirect).toBe('error');
        expect(url.searchParams.get('audience')).toBe(googleEnvironment.INHERITI_AUTOMATION_AUDIENCE);
        return new Response(`google-proof-${++proofNumber}`);
      }
      if (url.pathname.endsWith('/end')) return Response.json({ ok: true });
      return Response.json({ ok: true, result: {
        sessionToken: proofNumber === 1 ? 'first-token' : 'second-token',
        expiresAt: new Date(Date.now() + (proofNumber === 1 ? 15_000 : 120_000)).toISOString(),
      } });
    });
    clientFactory.mockImplementation(({ getBearerToken }) => ({ getPlan: vi.fn(), openReveal: vi.fn(), getBearerToken }));
    await withAutomationSecrets('https://business.example/api', googleEnvironment, async (context) => {
      expect(await context.core.getAccessToken()).toBe('second-token');
    }, transport);
    expect(paths).toEqual([
      '/computeMetadata/v1/instance/service-accounts/default/identity', '/api/automation/jobs',
      '/computeMetadata/v1/instance/service-accounts/default/identity', '/api/automation/jobs/renew', '/api/automation/jobs/end',
    ]);
    expect(bodies[1]).toEqual({ connectionId: 'connection-1', proof: 'google-proof-1' });
    expect(bodies[3]).toEqual({ proof: 'google-proof-2' });
  });

  it('fails before job start for wrong audience or oversized proof', async () => {
    const transport = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(16_384));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    })));
    await expect(withAutomationSecrets('https://business.example/api', { ...googleEnvironment, INHERITI_AUTOMATION_AUDIENCE: 'wrong' }, async () => 0, transport))
      .rejects.toThrow('automation_google_audience_invalid');
    expect(transport).not.toHaveBeenCalled();
    await expect(withAutomationSecrets('https://business.example/api', googleEnvironment, async () => 0, transport))
      .rejects.toThrow('automation_google_proof_invalid');
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe('AWS automation secret session', () => {
  it('rejects ECS host escapes and oversized metadata without a content length', async () => {
    const base = { INHERITI_AUTOMATION_PROVIDER: 'AWS', INHERITI_AUTOMATION_CONNECTION_ID: 'connection-1', AWS_REGION: 'us-east-1' };
    const challenge = Response.json({ ok: true, result: { challenge: 'a'.repeat(43), expiresAt: new Date(Date.now() + 60_000).toISOString() } });
    const escaped = vi.fn(async () => challenge.clone());
    await expect(withAutomationSecrets('https://business.example/api', {
      ...base, AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '//attacker.example/v2/credentials',
    }, async () => 0, escaped)).rejects.toThrow('automation_aws_role_credentials_required');
    expect(escaped).toHaveBeenCalledTimes(1);
    const oversized = vi.fn(async (input: RequestInfo | URL) => {
      if (new URL(String(input)).hostname !== '169.254.170.2') return challenge.clone();
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new Uint8Array(16_384));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      } }));
    });
    await expect(withAutomationSecrets('https://business.example/api', {
      ...base, AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/task',
    }, async () => 0, oversized)).rejects.toThrow('automation_aws_role_credentials_required');
    expect(oversized).toHaveBeenCalledTimes(2);
    const oversizedImdsToken = vi.fn(async (input: RequestInfo | URL) => {
      if (new URL(String(input)).hostname !== '169.254.169.254') return challenge.clone();
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new Uint8Array(4097));
        controller.close();
      } }));
    });
    await expect(withAutomationSecrets('https://business.example/api', base,
      async () => 0, oversizedImdsToken)).rejects.toThrow('automation_aws_role_credentials_required');
    expect(oversizedImdsToken).toHaveBeenCalledTimes(2);
  });

  it('requests a fresh challenge and signs it with temporary ECS role credentials for start and renew', async () => {
    const paths: string[] = [];
    const proofs: Array<Record<string, string>> = [];
    let challenges = 0;
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.hostname === '169.254.170.2') return Response.json({
        AccessKeyId: 'ASIAEXAMPLE000000000', SecretAccessKey: 'synthetic-secret', Token: 'role-session-token',
        Expiration: new Date(Date.now() + 3_600_000).toISOString(),
      });
      if (url.pathname.endsWith('/aws-challenge')) return Response.json({ ok: true, result: {
        challenge: `challenge-${++challenges}`, expiresAt: new Date(Date.now() + 60_000).toISOString(),
      } });
      if (url.pathname.endsWith('/end')) return Response.json({ ok: true });
      const body = JSON.parse(String(init?.body));
      proofs.push(JSON.parse(body.proof));
      return Response.json({ ok: true, result: { sessionToken: 'bearer',
        expiresAt: new Date(Date.now() + (proofs.length === 1 ? 15_000 : 120_000)).toISOString() } });
    });
    clientFactory.mockImplementation(({ getBearerToken }) => ({ getPlan: vi.fn(), openReveal: vi.fn(), getBearerToken }));
    await withAutomationSecrets('https://business.example/api', {
      INHERITI_AUTOMATION_PROVIDER: 'AWS', INHERITI_AUTOMATION_CONNECTION_ID: 'connection-1',
      AWS_REGION: 'us-east-1', AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/task',
    }, async (context) => { await context.core.getAccessToken(); }, transport);
    expect(paths).toEqual([
      '/api/automation/jobs/aws-challenge', '/v2/credentials/task', '/api/automation/jobs',
      '/api/automation/jobs/aws-challenge', '/v2/credentials/task', '/api/automation/jobs/renew', '/api/automation/jobs/end',
    ]);
    expect(proofs.map((proof) => proof.challenge)).toEqual(['challenge-1', 'challenge-2']);
    expect(proofs[0]?.authorization).toContain('SignedHeaders=content-type;host;x-amz-date;x-amz-security-token;x-inheriti-aws-challenge');
    expect(proofs[0]?.securityToken).toBe('role-session-token');
    expect(proofs[0]?.region).toBe('us-east-1');
  });
});
