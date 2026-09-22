import { describe, expect, it } from 'vitest';
import { JwksOperatorTokenValidator, OperatorTokenInvalid } from '../src/operator-auth.js';

const ISSUER = 'http://127.0.0.1:4564/realms/elements';
const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) } as const;

const keyPair = await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
const publicJwk = Object.assign(await crypto.subtle.exportKey('jwk', keyPair.publicKey), { kid: 'test-key', alg: 'RS256', use: 'sig' });

function base64Url(value: string | Uint8Array): string {
  const binary = typeof value === 'string' ? value : String.fromCharCode(...value);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

async function signToken(claims: Record<string, unknown>, kid = 'test-key'): Promise<string> {
  const signingInput = `${base64Url(JSON.stringify({ alg: 'RS256', kid }))}.${base64Url(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign(ALGORITHM.name, keyPair.privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER, aud: 'inheriti-elements-api', azp: 'elements-test-cli-device',
    sub: 'operator-1', sid: 'session-1', jti: 'token-1',
    elements_environment: 'TEST', scope: 'openid plan:list plan:read',
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  };
}

/** Serves the discovery + JWKS pair the validator fetches, so nothing is stubbed past the wire. */
const issuerFetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith('/.well-known/openid-configuration')) {
    return new Response(JSON.stringify({ jwks_uri: `${ISSUER}/protocol/openid-connect/certs` }), { status: 200 });
  }
  if (url.endsWith('/certs')) return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
  return new Response('not found', { status: 404 });
}) as typeof fetch;

const validator = new JwksOperatorTokenValidator(ISSUER, issuerFetch);

describe('JwksOperatorTokenValidator', () => {
  it('accepts a genuinely signed operator token and reads the claims Elements requires', async () => {
    const principal = await validator.validateAccessToken(await signToken(validClaims()));
    expect(principal).toMatchObject({
      issuer: ISSUER, authorizedParty: 'elements-test-cli-device',
      environment: 'TEST', subject: 'operator-1', sessionId: 'session-1',
    });
    expect(principal.scopes).toEqual(['openid', 'plan:list', 'plan:read']);
  });

  it('reads the signed Business integration environment claim', async () => {
    const principal = await validator.validateAccessToken(await signToken(validClaims({
      aud: 'inheriti-integrations-api', integrations_environment: 'LIVE', elements_environment: undefined,
    })));
    expect(principal.environment).toBe('LIVE');
  });

  it('uses the configured Business environment when its token has no custom environment claim', async () => {
    const businessValidator = new JwksOperatorTokenValidator(ISSUER, issuerFetch, 'TEST');
    const principal = await businessValidator.validateAccessToken(await signToken(validClaims({
      aud: 'inheriti-integrations-api', elements_environment: undefined,
    })));
    expect(principal.environment).toBe('TEST');
    const standalone = await validator.validateAccessToken(await signToken(validClaims({ elements_environment: undefined })));
    expect(standalone.environment).toBeUndefined();
  });

  it('refuses a token whose payload was edited after signing', async () => {
    const [header, , signature] = (await signToken(validClaims())).split('.');
    const forged = base64Url(JSON.stringify(validClaims({ azp: 'attacker-client' })));
    await expect(validator.validateAccessToken(`${header}.${forged}.${signature}`))
      .rejects.toMatchObject({ code: 'operator_token_signature_invalid' });
  });

  it('refuses an expired token', async () => {
    await expect(validator.validateAccessToken(await signToken(validClaims({ exp: Math.floor(Date.now() / 1000) - 1 }))))
      .rejects.toMatchObject({ code: 'operator_token_expired' });
  });

  it('refuses a token from another issuer even when the signature verifies', async () => {
    await expect(validator.validateAccessToken(await signToken(validClaims({ iss: 'https://evil.test/realms/elements' }))))
      .rejects.toMatchObject({ code: 'operator_token_issuer_mismatch' });
  });

  it('refuses a token signed by a key the issuer does not publish', async () => {
    await expect(validator.validateAccessToken(await signToken(validClaims(), 'unknown-key')))
      .rejects.toMatchObject({ code: 'operator_token_signing_key_unknown' });
  });

  it('refuses a malformed token rather than reading its claims', async () => {
    await expect(validator.validateAccessToken('not.a.token')).rejects.toBeInstanceOf(OperatorTokenInvalid);
    await expect(validator.validateAccessToken('two-parts.only')).rejects.toMatchObject({ code: 'operator_token_malformed' });
  });
});
