import { createSsdpV2Processor } from '@safetech/inheriti-core-sdk/workers/ssdp-v2';
import { encodeAssetContainer } from '@safetech/inheriti-core-sdk/core/protocols/ssdp+';

export interface FakeAssetFixture {
  id: string;
  code: string;
  name: string;
  type?: string;
  fields: Readonly<Record<string, string>>;
  matchOrigins?: readonly string[];
}

export interface FakeRevealStage {
  stage: string;
  dmsExpiresAt?: string;
  closedReason?: string;
  approvedModerators?: number;
  requiredModerators?: number;
}

export interface FakeElementsApiOptions {
  planId?: string;
  planName?: string;
  applicationId: string;
  /** 64 lowercase hex characters. Everything the fake seals is sealed under this. */
  masterKeyHex: string;
  assets?: readonly FakeAssetFixture[];
  /** Stages served before `AUTHORIZED`. A terminal stage here ends the reveal, as the server's would. */
  stagesBeforeAuthorization?: readonly FakeRevealStage[];
  expiresAt?: string;
  governance?: 'DIRECT' | 'GOVERNED';
}

export interface FakeApiCall { method: string; path: string }

/**
 * A real Elements reveal, served over `fetch`, with real cryptography behind it.
 *
 * The material this returns is genuinely split with SSDP v2, genuinely encrypted under a plan key,
 * and that plan key genuinely wrapped under the master key — so a host that reconstructs it has
 * proved it can do the actual work, not that it can parse a fixture. A stubbed `withReveal` cannot
 * make that claim, which is how the Chrome composition gap stayed invisible for so long.
 */
export class FakeElementsApi {
  readonly calls: FakeApiCall[] = [];
  closedWith: string | undefined;
  reconstructionReported: string | undefined;
  readonly authorizedActions: { assetId: string; fieldName?: string; action: string; origin?: string }[] = [];
  sharesCollected = false;
  private revealMode: 'DIRECT' | 'GOVERNED' = 'DIRECT';
  private stageIndex = 0;

  private constructor(
    private readonly options: Required<Pick<FakeElementsApiOptions, 'planId' | 'planName' | 'applicationId' | 'expiresAt' | 'governance'>> & FakeElementsApiOptions,
    private readonly material: unknown,
  ) {}

  static async create(options: FakeElementsApiOptions): Promise<FakeElementsApi> {
    const planId = options.planId ?? 'plan-1';
    const assets = options.assets ?? [{
      id: 'login-id', code: 'prod-db', name: 'Production database',
      fields: { username: 'alice', password: 'correct-horse' },
      matchOrigins: ['https://db.example.test'],
    }];
    const plaintext = encodeAssetContainer(assets.map((asset) => ({
      id: asset.id,
      type: asset.type ?? 'LOGIN',
      data: new TextEncoder().encode(JSON.stringify(asset.fields)),
    })));

    const split = await createSsdpV2Processor({ allowMainThreadFallback: true })
      .split(plaintext, { planId, threshold: 2, total: 3 }).result;

    const planKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const planKey = await crypto.subtle.importKey('raw', copy(planKeyBytes), { name: 'AES-GCM' }, false, ['encrypt']);
    const shares = await Promise.all([
      sealShare(split.dataShares[0]!, 'DATA_SHARD', planKey),
      sealShare(split.dataShares[1]!, 'BACKUP_SHARD', planKey),
      sealShare(split.keyShares[0]!, 'VALIDATOR_SHARD', planKey),
      sealShare(split.keyShares[1]!, 'CUSTODIAN_KEY_SHARD', planKey),
    ]);

    const material = {
      planId,
      mergeThreshold: 2,
      planKey: await wrapUnderMasterKey(planKeyBytes, options.masterKeyHex),
      shares,
      verifiedStorageLayerTypes: ['INHERITI_VAULT', 'INHERITI_CHAIN', 'INHERITI_HSM'],
      masterKeyWrapped: true,
      tenantId: options.applicationId,
      sourceReference: { system: 'INHERITI_ELEMENTS', contextId: options.applicationId, planId },
    };

    return new FakeElementsApi({
      ...options,
      planId,
      planName: options.planName ?? 'Production database',
      expiresAt: options.expiresAt ?? '2100-01-01T00:00:00.000Z',
      governance: options.governance ?? 'DIRECT',
      assets,
    }, material);
  }

  /** Drop-in for `fetchImpl`. Unknown routes fail loudly rather than returning an empty envelope. */
  readonly fetch = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const path = url.pathname.replace(/^\/+/, '');
    const method = init?.method ?? 'GET';
    this.calls.push({ method, path });
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
    return this.route(method, path, body);
  };

  private route(method: string, path: string, body: Record<string, unknown>): Response {
    const { planId } = this.options;
    if (method === 'GET' && path === `v1/plans/${planId}`) return ok(this.planDetail());
    /**
     * Master key acquisition, answered as "derive it yourself".
     *
     * A client composes acquisition whenever a host declares custody instead of a resolver, so this
     * route is on the reveal path now even for a host that never relays. `relayAvailable: false`
     * keeps that composition on the local branch, which is what a test driving a fake device has.
     */
    if (method === 'GET' && path === 'v1/master-key/acquisition') {
      return ok({ custody: 'DERIVED', configured: true, argon2Salt: null, relayAvailable: false });
    }
    if (method === 'GET' && path.startsWith('v1/master-key/acquisition/')) {
      return ok({ custody: 'DERIVED', configured: true, argon2Salt: null, relayAvailable: false });
    }
    // Both lanes name the key: `v1` is what an operator-authenticated host asks, `shared-plans` what
    // a credential-authenticated one asks. The SDK's reveal path uses the first.
    if (method === 'GET' && [`v1/plans/${planId}/material/key-reference`, `shared-plans/${planId}/material/key-reference`].includes(path)) {
      return ok({
        planId,
        masterKeyWrapped: true,
        tenantId: this.options.applicationId,
        sourceReference: { system: 'INHERITI_ELEMENTS', contextId: this.options.applicationId, planId },
      });
    }
    if (method === 'POST' && path === `v1/plans/${planId}/reveals`) {
      // The mode travels back on the session, as the API returns it: a host reads it there rather
      // than remembering what it asked for, and the scoped reveal keys its governed steps off it.
      this.revealMode = body.mode === 'GOVERNED' ? 'GOVERNED' : 'DIRECT';
      return ok(this.session('PENDING'));
    }
    if (method === 'GET' && path === 'v1/reveals/reveal-1') {
      const pending = this.options.stagesBeforeAuthorization ?? [];
      const next = pending[this.stageIndex];
      if (next !== undefined) {
        this.stageIndex += 1;
        return ok({ ...this.session(next.stage), ...next });
      }
      // Actions only open once the host has reported a successful reconstruction, which is what
      // `authorizeActionWhenOpen` checks before every field access.
      return ok(this.session(this.reconstructionReported === 'SUCCEEDED' ? 'ACTIONS_OPEN' : 'AUTHORIZED'));
    }
    if (method === 'POST' && path === 'v1/reveals/reveal-1/material') return ok({ material: this.material });
    // The host stating it holds the storage-layer shares. A governed reveal's merge process waits on
    // it, and a first custodian access advances past the custodian here rather than on the device.
    if (method === 'POST' && path === 'v1/reveals/reveal-1/shares-collected') {
      this.sharesCollected = true;
      return ok({});
    }
    if (method === 'POST' && path === 'v1/reveals/reveal-1/custodian-share/distribute') return ok({});
    if (method === 'PUT' && path === 'v1/reveals/reveal-1/reconstruction') {
      this.reconstructionReported = String(body.status);
      return ok(this.session(this.reconstructionReported === 'SUCCEEDED' ? 'ACTIONS_OPEN' : 'AUTHORIZED'));
    }
    if (method === 'POST' && path === 'v1/reveals/reveal-1/actions') {
      this.authorizedActions.push(body as never);
      return ok({ id: `action-${this.authorizedActions.length}`, status: 'AUTHORIZED' });
    }
    if (method === 'PUT' && /^v1\/reveals\/reveal-1\/actions\/[^/]+\/outcome$/.test(path)) {
      return ok({ id: 'action-1', status: 'REPORTED' });
    }
    if (method === 'POST' && path === 'v1/reveals/reveal-1/close') {
      this.closedWith = String(body.reason);
      return ok(this.session('CLOSED'));
    }
    return new Response(JSON.stringify({ ok: false, error: { code: 'fake_route_not_implemented' } }), {
      status: 404, headers: { 'content-type': 'application/json' },
    });
  }

  private session(stage: string): Record<string, unknown> {
    return {
      id: 'reveal-1', planId: this.options.planId, mode: this.revealMode, stage,
      expiresAt: this.options.expiresAt, materialVersion: '1',
    };
  }

  private planDetail(): Record<string, unknown> {
    const assets = this.options.assets ?? [];
    return {
      id: this.options.planId,
      name: this.options.planName,
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
      assetSummary: { count: assets.length, types: ['LOGIN'] },
      governance: { mode: this.options.governance, minimumApprovals: 0 },
      participantSummary: { owners: 1, mergers: 1, moderators: 0 },
      source: { kind: 'NATIVE' },
      revealPolicy: { masterKeyRelease: 'REQUIRED', custodian: 'FORCE' },
      participants: [],
      assets: assets.map((asset) => ({
        id: asset.id,
        code: asset.code,
        type: asset.type ?? 'LOGIN',
        name: asset.name,
        isBinary: false,
        fieldNames: Object.keys(asset.fields),
        ...(asset.matchOrigins === undefined ? {} : { matchOrigins: asset.matchOrigins }),
      })),
    };
  }
}

function ok(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}

async function sealShare(value: string, shareType: string, key: CryptoKey): Promise<Record<string, string>> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: copy(iv) }, key, copy(new TextEncoder().encode(value)));
  return {
    id: crypto.randomUUID(),
    storageLayerId: crypto.randomUUID(),
    shareType,
    data: `${base64(iv)}:${base64(new Uint8Array(sealed))}`,
  };
}

/** The exact wrap `unwrapDekWithMasterKey` opens: AES-GCM under the master key, IV prefixed. */
async function wrapUnderMasterKey(planKeyBytes: Uint8Array, masterKeyHex: string): Promise<string> {
  const master = await crypto.subtle.importKey('raw', copy(hexToBytes(masterKeyHex)), { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: copy(iv) }, master, copy(planKeyBytes)));
  const framed = new Uint8Array(iv.length + sealed.length);
  framed.set(iv, 0);
  framed.set(sealed, iv.length);
  return base64(framed);
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function hexToBytes(hex: string): Uint8Array {
  const matched = hex.match(/.{2}/g) ?? [];
  return new Uint8Array(matched.map((byte) => parseInt(byte, 16)));
}

function copy(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
