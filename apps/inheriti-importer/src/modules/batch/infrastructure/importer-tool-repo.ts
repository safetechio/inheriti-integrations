import type { ElectronHttpTransport } from '@modules/_shared/infrastructure/transport/electron-http-transport';
import type { MaterialisedAsset } from '@modules/plans/domain/asset-materializer';

/**
 * Client-side half of the wrap/unwrap boundary a staged field value crosses:
 * the organization's own backend must never be able to read a value it is
 * only holding until a human reviews and promotes it. The value is wrapped
 * here, under the organization key already released to this session, before
 * it ever leaves the process — the backend receives and stores only the
 * ciphertext, IV, and the (non-secret) binding context below. The matching
 * unwrap happens on a different client entirely, once that client acquires
 * its own release of the same organization key. Algorithm and idiom
 * (raw-imported AES-256-GCM key, fresh random 12-byte IV per value, a
 * JSON-serialized context bound in as AEAD additional authenticated data)
 * are not new: they reproduce, verbatim, the scheme already protecting the
 * organization key itself at rest in this app's own key vault.
 */

const ALGORITHM = 'AES-GCM';
const IV_BYTES = 12;
const CONTEXT_SCHEMA_VERSION = 2;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface StagedFieldValueContext {
  schemaVersion: number;
  organizationId: string;
  memberId: string;
  stagedItemId: string;
  assetId: string;
  fieldId: string;
}

export interface WrappedFieldValue {
  ciphertext: string;
  iv: string;
  algorithm: 'AES-GCM-256';
  context: StagedFieldValueContext;
}

function hexToBytes(hex: string): Uint8Array {
  const matched = hex.match(/.{2}/g);
  if (!matched || matched.length * 2 !== hex.length)
    throw new Error('INVALID_ORGANIZATION_KEY_MATERIAL');
  return new Uint8Array(matched.map((byte) => parseInt(byte, 16)));
}

const toBase64 = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)));

/**
 * `@types/node`'s global `Uint8Array` override makes it generic over
 * `ArrayBufferLike` (to also describe `Buffer`), while lib.dom's
 * `crypto.subtle`/`crypto.getRandomValues` signatures require the narrower
 * `ArrayBufferView<ArrayBuffer>`. Both describe the same runtime bytes; this
 * narrows the type only, with no effect on behavior.
 */
function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

function contextBytes(context: StagedFieldValueContext): Uint8Array {
  // Deterministic key order: AEAD verification fails on any byte difference,
  // so the same context must always serialize identically on both sides.
  const ordered = {
    schemaVersion: context.schemaVersion,
    organizationId: context.organizationId,
    memberId: context.memberId,
    stagedItemId: context.stagedItemId,
    assetId: context.assetId,
    fieldId: context.fieldId,
  };
  return new TextEncoder().encode(JSON.stringify(ordered));
}

async function importOrganizationKey(organizationKeyHex: string): Promise<CryptoKey> {
  if (!/^[0-9a-f]{64}$/.test(organizationKeyHex))
    throw new Error('INVALID_ORGANIZATION_KEY_MATERIAL');
  return crypto.subtle.importKey(
    'raw',
    asBufferSource(hexToBytes(organizationKeyHex)),
    { name: ALGORITHM },
    false,
    ['encrypt'],
  );
}

export async function wrapFieldValue(
  plaintext: string,
  organizationKeyHex: string,
  context: StagedFieldValueContext,
): Promise<WrappedFieldValue> {
  const key = await importOrganizationKey(organizationKeyHex);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: ALGORITHM,
      iv: asBufferSource(iv),
      additionalData: asBufferSource(contextBytes(context)),
    },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: toBase64(ciphertext), iv: toBase64(iv), algorithm: 'AES-GCM-256', context };
}

/**
 * Flattens a materialised Asset's non-empty `secret.*` and `meta.*` (name is
 * carried separately as the asset draft's plaintext `title`; the rest —
 * `notes`, `isMedia`, `mimeType`, `fileName` — is free text or otherwise
 * worth keeping out of an unencrypted draft) leaves into dot-path field ids,
 * matching the same `'secret.password'`-style paths
 * `modules/plans/domain/asset-materializer.ts` already uses when binding
 * source fields. Every leaf value is stringified: the promotion side must
 * parse `meta.isMedia` back to a boolean and leave every other leaf as a
 * string.
 */
function flattenToFields(
  bag: Record<string, unknown>,
  prefix: string,
): { fieldId: string; value: string }[] {
  const out: { fieldId: string; value: string }[] = [];
  for (const [key, value] of Object.entries(bag)) {
    if (value === undefined || value === null || value === '') continue;
    const fieldId = `${prefix}.${key}`;
    if (typeof value === 'object' && !Array.isArray(value)) {
      out.push(...flattenToFields(value as Record<string, unknown>, fieldId));
    } else {
      out.push({ fieldId, value: String(value) });
    }
  }
  return out;
}

export interface StagedAssetInput {
  id: string;
  type: string;
  title: string;
  fields: { fieldId: string; value: string }[];
}

/** Pure — no crypto, no I/O — so it is unit-testable on its own. */
export function buildStagedAssetInput(asset: MaterialisedAsset): StagedAssetInput {
  if (!asset.id) throw new Error('MATERIALISED_ASSET_MISSING_ID');
  return {
    id: asset.id,
    type: asset.type,
    title: asset.meta.name,
    fields: [
      ...flattenToFields(asset.secret, 'secret'),
      ...flattenToFields(
        {
          notes: asset.meta.notes,
          isMedia: asset.meta.isMedia,
          mimeType: asset.meta.mimeType,
          fileName: asset.meta.fileName,
        },
        'meta',
      ),
    ],
  };
}

export interface StageBatchItemRequest {
  id: string;
  organizationId: string;
  memberId: string;
  organizationKeyHex: string;
  planDraft: StagedPlanDraft;
  assets: readonly MaterialisedAsset[];
  ttlHours?: number;
}

export interface StagedPlanDraft {
  name: string;
  description?: string;
  [key: string]: unknown;
}

export class ImporterToolRequestError extends Error {
  readonly code: string | undefined;
  readonly status: number;

  constructor(status: number, body: unknown) {
    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : undefined;
    const description = typeof record?.description === 'string' ? record.description : undefined;
    const code = typeof record?.error === 'string' ? record.error : undefined;
    super(description || code || `The staging request failed (${status}).`);
    this.code = code;
    this.status = status;
  }
}

function stagedItemsPath(organizationId: string, id?: string): string {
  const base = `/organizations/${encodeURIComponent(organizationId)}/importer-tool/staged-items`;
  return id ? `${base}/${encodeURIComponent(id)}` : base;
}

/**
 * Plain HTTP repository over the Business API's `importer-tool` module.
 */
export class ImporterToolRepo {
  private readonly stagedItemIds = new Map<string, string>();
  private readonly stagedAssetIds = new Map<string, string>();

  constructor(private readonly transport: ElectronHttpTransport) {}

  private resolveUuid(ids: Map<string, string>, id: string): string {
    if (UUID_PATTERN.test(id)) return id;
    const existing = ids.get(id);
    if (existing) return existing;
    const generated = crypto.randomUUID();
    ids.set(id, generated);
    return generated;
  }

  /** True if a staged item with this id already exists for this organization. */
  async isStaged(organizationId: string, id: string): Promise<boolean> {
    const stagedItemId = this.resolveUuid(this.stagedItemIds, id);
    const response = await this.transport.request<{ error?: string }>({
      method: 'GET',
      path: stagedItemsPath(organizationId, stagedItemId),
      returnErrorResponse: true,
    });
    if (response.status >= 200 && response.status < 300) return true;
    if (response.status === 400 && response.body?.error === 'staged_item_not_found') return false;
    throw new ImporterToolRequestError(response.status, response.body);
  }

  async stage(request: StageBatchItemRequest): Promise<{ id: string; expiresAt: string }> {
    if (!request.planDraft.name.trim()) throw new Error('STAGED_PLAN_MISSING_NAME');
    const stagedItemId = this.resolveUuid(this.stagedItemIds, request.id);
    // `planDraft` is built from the same Core create-payload shape, whose
    // canonical metadata fields are `name` and `description`.
    // The payload also carries plaintext `assets` — those are sent separately,
    // wrapped, as `assetDrafts` below, and must never also ride along unwrapped
    // here.
    const planDraft = Object.fromEntries(
      Object.entries(request.planDraft).filter(([key]) => key !== 'assets'),
    );

    const assetDrafts = await Promise.all(
      request.assets.map(async (asset) => {
        const input = buildStagedAssetInput(asset);
        const assetId = UUID_PATTERN.test(input.id)
          ? input.id
          : this.resolveUuid(this.stagedAssetIds, `${stagedItemId}:${input.id}`);
        return {
          id: assetId,
          type: input.type,
          title: input.title,
          fields: await Promise.all(
            input.fields.map(async (field) => ({
              fieldId: field.fieldId,
              envelope: await wrapFieldValue(field.value, request.organizationKeyHex, {
                schemaVersion: CONTEXT_SCHEMA_VERSION,
                organizationId: request.organizationId,
                memberId: request.memberId,
                stagedItemId,
                assetId,
                fieldId: field.fieldId,
              }),
            })),
          ),
        };
      }),
    );

    const response = await this.transport.request<{ result?: { id: string; expiresAt: string } }>({
      method: 'POST',
      path: stagedItemsPath(request.organizationId),
      body: { id: stagedItemId, planDraft, assetDrafts, ttlHours: request.ttlHours },
    });

    if (response.status < 200 || response.status >= 300 || !response.body?.result) {
      throw new ImporterToolRequestError(response.status, response.body);
    }
    return response.body.result;
  }
}
