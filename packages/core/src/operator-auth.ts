import type {
  OAuthClock,
  OAuthCrypto,
  OAuthTransaction,
  OAuthTransactionStore,
  OperatorAuthConfiguration,
  OperatorAuthTransport,
  OperatorSession,
  OperatorSessionStore,
  OperatorTokenValidator,
  ValidatedOperatorToken,
} from '@safetech/inheriti-client-sdk';
import type { ElementsEnvironment, OperatorAuthFacade } from './index.js';
import { INTEGRATION_AUTHORITY } from './deployment.js';

/**
 * The SDK defines `OperatorTokenValidator` as a port and ships no implementation, so without this
 * every host — CLI, VS Code, Chrome — would write its own token verification, and the weakest one
 * would set the bar. One implementation, shared, is the whole point of this package (D025).
 *
 * Web Crypto rather than `node:crypto` so the same code verifies inside a Chrome service worker.
 */
export class JwksOperatorTokenValidator implements OperatorTokenValidator {
  private keys: Promise<Map<string, CryptoKey>> | undefined;

  constructor(
    private readonly issuer: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly businessEnvironment?: ElementsEnvironment,
  ) {}

  async validateAccessToken(accessToken: string): Promise<ValidatedOperatorToken> {
    return this.principalOf(await this.verify(accessToken));
  }

  async validateIdToken(idToken: string): Promise<ValidatedOperatorToken> {
    const claims = await this.verify(idToken);
    return Object.assign(this.principalOf(claims), { scopes: [], nonce: claims.nonce as string | undefined });
  }

  private signingKeys(): Promise<Map<string, CryptoKey>> {
    this.keys ??= this.loadSigningKeys().catch(error => {
      this.keys = undefined;
      throw error;
    });
    return this.keys;
  }

  private async loadSigningKeys(): Promise<Map<string, CryptoKey>> {
    const discovery = await this.json(`${this.issuer.replace(/\/$/u, '')}/.well-known/openid-configuration`);
    const jwks = await this.json(String(discovery.jwks_uri));
    const usable = (jwks.keys as Record<string, unknown>[] ?? [])
      .filter((key) => key.kty === 'RSA' && (key.alg ?? 'RS256') === 'RS256' && (key.use ?? 'sig') === 'sig');
    const imported = await Promise.all(usable.map(async (key) => [
      String(key.kid),
      await globalThis.crypto.subtle.importKey('jwk', key as JsonWebKey, RSA_PSS, false, ['verify']),
    ] as const));
    if (imported.length === 0) throw new OperatorTokenInvalid('operator_token_signing_keys_unavailable');
    return new Map(imported);
  }

  private async json(url: string): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(url);
    if (!response.ok) throw new OperatorTokenInvalid('operator_token_issuer_unreachable');
    return await response.json() as Record<string, unknown>;
  }

  private async verify(token: string): Promise<Record<string, unknown>> {
    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature) throw new OperatorTokenInvalid('operator_token_malformed');
    const kid = String(decodeSegment(header).kid ?? '');
    const key = (await this.signingKeys()).get(kid);
    if (!key) throw new OperatorTokenInvalid('operator_token_signing_key_unknown');
    const verified = await globalThis.crypto.subtle.verify(
      RSA_PSS.name,
      key,
      base64UrlToBytes(signature),
      new TextEncoder().encode(`${header}.${payload}`),
    );
    if (!verified) throw new OperatorTokenInvalid('operator_token_signature_invalid');
    const claims = decodeSegment(payload);
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) {
      throw new OperatorTokenInvalid('operator_token_expired');
    }
    if (claims.iss !== this.issuer) throw new OperatorTokenInvalid('operator_token_issuer_mismatch');
    return claims;
  }

  private principalOf(claims: Record<string, unknown>): ValidatedOperatorToken {
    return {
      issuer: String(claims.iss),
      audience: claims.aud as string | readonly string[],
      authorizedParty: String(claims.azp ?? ''),
      environment: (claims.integrations_environment ?? claims.elements_environment ?? this.businessEnvironment) as ElementsEnvironment,
      subject: String(claims.sub ?? ''),
      sessionId: String(claims.sid ?? ''),
      tokenId: String(claims.jti ?? ''),
      scopes: String(claims.scope ?? '').split(' ').filter(Boolean),
    };
  }
}

const RSA_PSS = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

export class OperatorTokenInvalid extends Error {
  constructor(readonly code: string) { super(code); this.name = 'OperatorTokenInvalid'; }
}

function decodeSegment(segment: string): Record<string, unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as Record<string, unknown>;
  } catch {
    throw new OperatorTokenInvalid('operator_token_malformed');
  }
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/gu, '+').replace(/_/gu, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return new Uint8Array(Array.from(binary, (character) => character.charCodeAt(0)));
}

/** Process-lifetime stores. A host that can reach secure storage supplies its own instead. */
export class MemoryOperatorSessionStore implements OperatorSessionStore {
  private session: OperatorSession | undefined;
  async load(): Promise<OperatorSession | undefined> { return this.session; }
  async save(session: OperatorSession): Promise<void> { this.session = session; }
  async clear(): Promise<void> { this.session = undefined; }
}

export class MemoryOAuthTransactionStore implements OAuthTransactionStore {
  private readonly transactions = new Map<string, OAuthTransaction>();
  async load(key: string): Promise<OAuthTransaction | undefined> { return this.transactions.get(key); }
  async save(key: string, transaction: OAuthTransaction): Promise<void> { this.transactions.set(key, transaction); }
  async remove(key: string): Promise<void> { this.transactions.delete(key); }
}

export type OperatorAuthOptions = {
  configuration: OperatorAuthConfiguration;
  apiUrl?: string;
  /** Secure, host-specific storage. The defaults are in-memory and lose the session on exit. */
  sessions?: OperatorSessionStore;
  transactions?: OAuthTransactionStore;
  tokenValidator?: OperatorTokenValidator;
  fetchImpl?: typeof fetch;
  authFetchImpl?: typeof fetch;
} & ({ business: true; businessAuthority?: 'business' | 'safeid-oidc' }
  | { business?: never; businessAuthority?: never });

/**
 * The SDK classes an entrypoint supplies. The browser barrel and the Node entry export the same
 * operator-auth module, but only one of them may be loaded in a given host: importing the browser
 * barrel under plain Node ESM drags in `safekey-sdk`, whose published bundle cannot be resolved
 * there (D028). Composition lives here once; each entry hands in its own runtime.
 */
export interface OperatorAuthRuntime {
  OperatorAuthClient: new (options: {
    configuration: OperatorAuthConfiguration;
    businessApiUrl?: string | undefined;
    businessAuthority?: 'business' | 'safeid-oidc' | undefined;
    transport: OperatorAuthTransport;
    tokenValidator: OperatorTokenValidator;
    sessions: OperatorSessionStore;
    transactions: OAuthTransactionStore;
    clock?: OAuthClock;
    crypto?: OAuthCrypto;
  }) => unknown;
  HttpOperatorAuthTransport: new (http?: typeof fetch) => OperatorAuthTransport;
  SystemOAuthClock: new () => OAuthClock;
  WebOAuthCrypto: new () => OAuthCrypto;
}

/**
 * Single-flight refresh, PKCE and the device grant all live in the SDK's `OperatorAuthClient`; this
 * only supplies the ports it needs, so no host re-solves them (D009) and none writes its own token
 * verification (D025).
 */
export function composeOperatorAuth(runtime: OperatorAuthRuntime, options: OperatorAuthOptions): OperatorAuthFacade {
  if (options.business && !options.apiUrl) throw new Error('Business operator auth requires an API URL');
  const businessAuthority = options.business ? options.businessAuthority ?? INTEGRATION_AUTHORITY : undefined;
  if (businessAuthority === 'safeid-oidc' && options.configuration.audience !== 'inheriti-integrations-api') {
    throw new Error('SafeID OIDC Business auth requires the inheriti-integrations-api audience');
  }
  const authFetch = options.authFetchImpl ?? options.fetchImpl;
  return new runtime.OperatorAuthClient({
    configuration: options.configuration,
    businessApiUrl: options.business ? options.apiUrl : undefined,
    businessAuthority,
    transport: new runtime.HttpOperatorAuthTransport(authFetch),
    tokenValidator: options.tokenValidator
      ?? new JwksOperatorTokenValidator(options.configuration.issuer, authFetch,
        options.configuration.audience === 'inheriti-integrations-api' ? options.configuration.environment : undefined),
    sessions: options.sessions ?? new MemoryOperatorSessionStore(),
    transactions: options.transactions ?? new MemoryOAuthTransactionStore(),
    clock: new runtime.SystemOAuthClock(),
    crypto: new runtime.WebOAuthCrypto(),
  }) as OperatorAuthFacade;
}
