import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ElectronHttpTransport } from '@modules/_shared/infrastructure/transport/electron-http-transport';
import type { MaterialisedAsset } from '@modules/plans/domain/asset-materializer';
import {
  ImporterToolRepo,
  ImporterToolRequestError,
  buildStagedAssetInput,
  wrapFieldValue,
} from '@modules/batch/infrastructure/importer-tool-repo';

const ORG_KEY_HEX = 'b'.repeat(64);

function fakeTransport(
  handler: (request: { method: string; path: string; body?: unknown }) => {
    status: number;
    body: unknown;
  },
) {
  return {
    request: vi.fn(async (request) => handler(request)),
  } as unknown as ElectronHttpTransport;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('buildStagedAssetInput', () => {
  it('flattens secret leaves into dot-path field ids, and skips empty/missing meta extras', () => {
    const asset: MaterialisedAsset = {
      id: 'asset-1',
      type: 'USER-PSWD',
      meta: {
        name: 'My Login',
        notes: undefined,
        isMedia: undefined,
        mimeType: undefined,
        fileName: undefined,
      },
      secret: { username: 'alice', password: 'hunter2', nested: { note: 'inner' } },
    };

    const input = buildStagedAssetInput(asset);

    expect(input.id).toBe('asset-1');
    expect(input.type).toBe('USER-PSWD');
    expect(input.title).toBe('My Login');
    expect(input.fields).toEqual(
      expect.arrayContaining([
        { fieldId: 'secret.username', value: 'alice' },
        { fieldId: 'secret.password', value: 'hunter2' },
        { fieldId: 'secret.nested.note', value: 'inner' },
      ]),
    );
    expect(input.fields).toHaveLength(3);
  });

  it('includes populated meta extras (notes/isMedia/mimeType/fileName) as their own fields', () => {
    const asset: MaterialisedAsset = {
      id: 'asset-2',
      type: 'ATTACHMENT',
      meta: {
        name: 'File',
        notes: 'sensitive note',
        isMedia: true,
        mimeType: 'image/png',
        fileName: 'x.png',
      },
      secret: { blob: 'base64data' },
    };

    const input = buildStagedAssetInput(asset);

    expect(input.fields).toEqual(
      expect.arrayContaining([
        { fieldId: 'secret.blob', value: 'base64data' },
        { fieldId: 'meta.notes', value: 'sensitive note' },
        { fieldId: 'meta.isMedia', value: 'true' },
        { fieldId: 'meta.mimeType', value: 'image/png' },
        { fieldId: 'meta.fileName', value: 'x.png' },
      ]),
    );
  });

  it('throws rather than silently dropping an asset with no id', () => {
    const asset: MaterialisedAsset = {
      type: 'PLAIN-TEXT',
      meta: { name: 'x' },
      secret: { a: '1' },
    };
    expect(() => buildStagedAssetInput(asset)).toThrow('MATERIALISED_ASSET_MISSING_ID');
  });
});

describe('wrapFieldValue', () => {
  it('produces a non-plaintext AES-GCM-256 envelope that round-trips under the same key/context', async () => {
    const context = {
      schemaVersion: 2,
      organizationId: 'org-1',
      memberId: 'member-1',
      stagedItemId: 'plan-1',
      assetId: 'asset-1',
      fieldId: 'secret.password',
    };
    const wrapped = await wrapFieldValue('correct horse battery staple', ORG_KEY_HEX, context);

    expect(wrapped.algorithm).toBe('AES-GCM-256');
    expect(wrapped.context).toEqual(context);
    expect(JSON.stringify(wrapped)).not.toContain('correct horse');

    const key = await crypto.subtle.importKey(
      'raw',
      Uint8Array.from(Buffer.from(ORG_KEY_HEX, 'hex')),
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: Uint8Array.from(atob(wrapped.iv), (c) => c.charCodeAt(0)),
        additionalData: new TextEncoder().encode(JSON.stringify(context)),
      },
      key,
      Uint8Array.from(atob(wrapped.ciphertext), (c) => c.charCodeAt(0)),
    );
    expect(new TextDecoder().decode(plaintext)).toBe('correct horse battery staple');
  });
});

describe('ImporterToolRepo', () => {
  it('stage() sends only wrapped envelopes and UUID-compatible legacy ids', async () => {
    let sentBody: any;
    let reconciledPath = '';
    const transport = fakeTransport((request) => {
      if (request.method === 'POST') {
        sentBody = request.body;
        return {
          status: 201,
          body: {
            result: { id: sentBody.id, expiresAt: '2026-01-01T00:00:00.000Z' },
          },
        };
      }
      if (request.method === 'GET') {
        reconciledPath = request.path;
        return { status: 400, body: { error: 'staged_item_not_found' } };
      }
      throw new Error('unexpected method');
    });
    const repo = new ImporterToolRepo(transport);

    const asset: MaterialisedAsset = {
      id: 'asset-1',
      type: 'PLAIN-TEXT',
      meta: { name: 'Secret' },
      secret: { value: 's3cr3t' },
    };
    const result = await repo.stage({
      id: 'plan-1',
      organizationId: 'org-1',
      memberId: 'member-1',
      organizationKeyHex: ORG_KEY_HEX,
      planDraft: {
        name: 'My Plan',
        description: 'Imported plan description',
        assets: [{ secret: { value: 's3cr3t' } }],
      },
      assets: [asset],
    });

    expect(result).toEqual({ id: sentBody.id, expiresAt: '2026-01-01T00:00:00.000Z' });
    expect(sentBody.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(sentBody.assetDrafts[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(sentBody.planDraft).toEqual({
      name: 'My Plan',
      description: 'Imported plan description',
    });
    expect(JSON.stringify(sentBody)).not.toContain('s3cr3t');
    expect(sentBody.assetDrafts[0].fields[0].envelope.algorithm).toBe('AES-GCM-256');
    await expect(repo.isStaged('org-1', 'plan-1')).resolves.toBe(false);
    expect(reconciledPath.endsWith(`/${sentBody.id}`)).toBe(true);
  });

  it('stage() throws ImporterToolRequestError with the API-provided description on failure', async () => {
    const transport = fakeTransport(() => ({
      status: 400,
      body: {
        ok: false,
        error: 'staged_item_requires_at_least_one_asset',
        description: 'no assets',
      },
    }));
    const repo = new ImporterToolRepo(transport);

    await expect(
      repo.stage({
        id: 'plan-1',
        organizationId: 'org-1',
        memberId: 'member-1',
        organizationKeyHex: ORG_KEY_HEX,
        planDraft: { name: 'Plan without assets' },
        assets: [],
      }),
    ).rejects.toThrow(ImporterToolRequestError);
  });

  it('stage() rejects a plan without a non-empty canonical name before sending it', async () => {
    const transport = fakeTransport(() => {
      throw new Error('the transport must not be called');
    });
    const repo = new ImporterToolRepo(transport);

    await expect(
      repo.stage({
        id: 'plan-1',
        organizationId: 'org-1',
        memberId: 'member-1',
        organizationKeyHex: ORG_KEY_HEX,
        planDraft: { name: '   ', description: 'Description' },
        assets: [],
      }),
    ).rejects.toThrow('STAGED_PLAN_MISSING_NAME');
  });

  it('isStaged() returns true on 2xx, false on staged_item_not_found, and throws on any other error', async () => {
    const found = new ImporterToolRepo(
      fakeTransport(() => ({ status: 200, body: { result: { id: 'plan-1' } } })),
    );
    await expect(found.isStaged('org-1', 'plan-1')).resolves.toBe(true);

    const notFound = new ImporterToolRepo(
      fakeTransport(() => ({ status: 400, body: { error: 'staged_item_not_found' } })),
    );
    await expect(notFound.isStaged('org-1', 'plan-1')).resolves.toBe(false);

    const forbidden = new ImporterToolRepo(
      fakeTransport(() => ({ status: 403, body: { error: 'forbidden' } })),
    );
    await expect(forbidden.isStaged('org-1', 'plan-1')).rejects.toThrow(ImporterToolRequestError);
  });
});
