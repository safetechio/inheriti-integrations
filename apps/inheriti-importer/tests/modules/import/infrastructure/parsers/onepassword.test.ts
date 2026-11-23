import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseOnePassword } from '@modules/import/infrastructure/parsers/onepassword';
import { VaultFormatError } from '@modules/import/domain/vault';
import { VaultFileImportParser } from '@modules/import/infrastructure/vault-file-import-parser';
import { importSessionFromVaultState } from '@modules/import/infrastructure/stores/vault-session-adapter';
import {
  entriesFromParse,
  initialVaultState,
} from '@modules/import/infrastructure/stores/vault-store';

function archive(data: unknown, files: Record<string, Uint8Array> = {}): ArrayBuffer {
  const zipped = zipSync({
    'export.attributes': strToU8(JSON.stringify({ version: 3, timestamp: 1 })),
    'export.data': strToU8(JSON.stringify(data)),
    ...files,
  });
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
}

const item = {
  uuid: 'source-item',
  categoryUuid: '002',
  overview: {
    title: 'Card',
    url: 'https://primary.example',
    urls: [{ url: 'https://other.example', label: 'other' }],
  },
  details: {
    loginFields: [
      { designation: 'username', value: 'ada' },
      { designation: 'password', value: 'secret' },
    ],
    notesPlain: 'private note',
    sections: [
      {
        title: 'Payment',
        fields: [
          { title: 'Payment account', value: { creditCardNumber: '4111' } },
          { title: 'PIN', value: { concealed: '1234' } },
          { title: 'custom', value: { string: 'first' } },
          { title: 'custom', value: { string: 'second' } },
        ],
      },
    ],
  },
};

function exportData(items: unknown[]) {
  return { accounts: [{ vaults: [{ attrs: { name: 'Personal' }, items }] }] };
}

describe('parseOnePassword', () => {
  it('keeps native scalars readable after unknown nested content exhausts its budget', () => {
    const source = {
      ...item,
      details: {
        loginFields: [
          {
            name: 'password',
            designation: 'password',
            value: 'current-secret',
            unknown: Object.fromEntries(Array.from({ length: 3000 }, (_, i) => ['key' + i, i])),
          },
        ],
        sections: [
          { title: 'Extras', fields: [{ title: 'Token', value: { string: 'later-scalar' } }] },
        ],
      },
    };
    const entry = parseOnePassword(archive(exportData([source]))).entries[0];
    expect(entry.password).toBe('current-secret');
    expect(entry.extraFields).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: 'later-scalar' })]),
    );
  });

  it('reports a wide history that exceeds recovery work limits without copying every child', () => {
    const source = {
      ...item,
      details: { passwordHistory: Array.from({ length: 10000 }, (_, i) => i) },
    };
    const result = parseOnePassword(archive(exportData([source])));
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'onepassword-recovery-limit', kind: 'unsupported' }),
      ]),
    );
    expect(
      result.entries[0].extraFields.some(
        ({ metadata }) => metadata?.sourceKey === 'passwordHistory',
      ),
    ).toBe(false);
  });

  it('retains exact owner paths for unknown scalar login properties', () => {
    const source = {
      ...item,
      details: {
        loginFields: [
          { name: 'a', value: 'x', username: 'alpha', password: 'same-owner' },
          { name: 'b', value: 'y', password: 'different-owner' },
        ],
      },
    };
    const fields = parseOnePassword(archive(exportData([source]))).entries[0].extraFields;
    const username = fields.find(({ metadata }) => metadata?.sourceKey === 'username')!;
    const passwords = fields.filter(({ metadata }) => metadata?.sourceKey === 'password');
    expect(username.metadata?.sourceRecordPath).toBe(passwords[0].metadata?.sourceRecordPath);
    expect(username.metadata?.sourceRecordPath).not.toBe(passwords[1].metadata?.sourceRecordPath);
    expect(JSON.parse(username.metadata!.sourcePath!)).toEqual([
      'details',
      'loginFields',
      '0',
      'username',
    ]);
  });

  it('preserves canonical fields, section fields, duplicates and vault grouping', () => {
    const result = parseOnePassword(archive(exportData([item])));
    expect(result.kind).toBe('onepassword');
    expect(result.entries[0]).toMatchObject({
      id: '0:0:source-item',
      title: 'Card',
      username: 'ada',
      password: 'secret',
      url: 'https://primary.example',
      notes: 'private note',
      group: 'Personal',
      category: '002',
    });
    expect(result.entries[0].extraFields.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: 'URL: other', value: 'https://other.example' },
      { key: 'creditCardNumber', value: '4111' },
      { key: 'Payment: PIN', value: '1234' },
      { key: 'Payment: custom', value: 'first' },
      { key: 'Payment: custom (2)', value: 'second' },
    ]);
  });

  it('carries source facts through both normalization paths with distinct duplicate fields', async () => {
    const fileName = 'export.1pux';
    const data = archive(exportData([item]));
    const parsed = parseOnePassword(data);
    const normalized = await new VaultFileImportParser().parse({ fileName, data });
    const [entry] = entriesFromParse(parsed, normalized.source.id);
    const session = importSessionFromVaultState({
      ...initialVaultState,
      vaults: [{ ...normalized.source, kind: parsed.kind }],
      entries: [{ current: entry, original: entry }],
    });

    for (const [node, fields] of [
      [normalized.nodes.find((candidate) => candidate.kind === 'entry'), normalized.fields],
      [session.nodesById[entry.id], Object.values(session.fieldsById)],
    ] as const) {
      expect(node?.sourceHints).toEqual({ sourceKind: 'onepassword', category: '002' });
      expect(fields.find(({ metadata }) => metadata.sourceRole === 'password')?.metadata).toEqual({
        sourceKey: 'password',
        sourceRole: 'password',
        sourceDesignation: 'password',
        sourceFieldType: 'string',
      });
      expect(
        fields.find(({ metadata }) => metadata.sourceFieldType === 'creditCardNumber')?.metadata,
      ).toEqual({
        sourceKey: 'Payment account',
        sourceSection: 'Payment',
        sourceSectionIdentity: '0',
        sourceFieldType: 'creditCardNumber',
      });
      expect(fields.find(({ metadata }) => metadata.role === 'notes')?.metadata.sourceKey).toBe(
        'notesPlain',
      );
      expect(
        fields.filter(({ metadata }) => metadata.sourceRole === 'url').map(({ name }) => name),
      ).toEqual(['url']);
      const duplicates = fields.filter(({ metadata }) => metadata.sourceKey === 'custom');
      expect(new Set(duplicates.map(({ id }) => id)).size).toBe(2);
      expect(duplicates.map(({ value }) => value.reveal())).toEqual(['first', 'second']);
      expect(JSON.stringify(fields.map(({ metadata }) => metadata))).not.toContain('4111');
    }
  });

  it('uses distinct section identities even when source titles are duplicated or absent', async () => {
    const data = archive(
      exportData([
        {
          ...item,
          details: {
            sections: ['Payment', 'Payment', '', ''].map((title, index) => ({
              title,
              fields: [{ title: 'custom', value: { string: String(index) } }],
            })),
          },
        },
      ]),
    );
    const { fields } = await new VaultFileImportParser().parse({ fileName: 'export.1pux', data });
    const sections = fields.filter(({ metadata }) => metadata.sourceKey === 'custom');
    expect(sections.map(({ metadata }) => metadata.sourceSection)).toEqual([
      'Payment',
      'Payment',
      'Details',
      'Details',
    ]);
    expect(new Set(sections.map(({ metadata }) => metadata.sourceSectionIdentity)).size).toBe(4);
  });

  it('warns about file attachments and unsupported fields', () => {
    const broken = {
      ...item,
      details: {
        ...item.details,
        sections: [{ fields: [{ title: 'unknown', value: { binary: {} } }] }],
      },
    };
    const result = parseOnePassword(
      archive(exportData([broken]), { 'files/attachment': strToU8('x') }),
    );
    expect(result.warnings).toContain('1 file attachment skipped.');
    expect(result.warnings).toContain('Item "Card", Details field "unknown" was skipped.');
  });

  it('skips file-only items and keeps text on mixed document items', () => {
    const fileOnly = {
      uuid: 'file',
      categoryUuid: '006',
      overview: { title: 'File' },
      details: { documentAttributes: { file: 'blob' } },
    };
    const mixed = {
      ...fileOnly,
      uuid: 'mixed',
      details: { documentAttributes: { file: 'blob' }, notesPlain: 'Keep this note' },
    };
    const overview = {
      ...fileOnly,
      uuid: 'overview',
      overview: { title: 'Overview', url: 'https://example.invalid', custom: 'field' },
    };
    const structured = {
      ...fileOnly,
      uuid: 'structured',
      details: { ...fileOnly.details, notesPlain: { text: 'Structured note' } },
    };
    const result = parseOnePassword(archive(exportData([fileOnly, mixed, overview, structured])));
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0].notes).toBe('Keep this note');
    expect(result.entries[1].url).toBe('https://example.invalid');
    expect(result.entries[1].extraFields.map(({ key, value }) => ({ key, value }))).toContainEqual({
      key: 'overview/custom',
      value: 'field',
    });
    expect(result.entries[2].extraFields.map(({ key, value }) => ({ key, value }))).toContainEqual({
      key: 'details/notesPlain',
      value: '{"text":"Structured note"}',
    });
    expect(result.warnings).toContain('File-only item "File" was skipped.');
    expect(result.warnings).toContain('File content in item "File" was skipped.');
  });

  it('retains source categories and reports omitted URL matching settings', () => {
    const result = parseOnePassword(
      archive(
        exportData([
          {
            uuid: 'metadata',
            categoryUuid: '001',
            overview: {
              title: 'Metadata example',
              urls: [{ url: 'https://example.invalid', mode: 0 }],
            },
            details: {},
          },
        ]),
      ),
    );
    expect(result.entries[0].url).toBe('https://example.invalid');
    expect(result.entries[0].sourceHints?.category).toBe('001');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'onepassword-url-metadata', kind: 'skipped', count: 1 }),
      ]),
    );
  });

  it('reports skipped fields and retains password history without exposing values in diagnostics', () => {
    const secret = 'DO-NOT-SHOW-THIS-SECRET';
    const affected = {
      ...item,
      details: {
        loginFields: [{ name: 'Recovery code', value: { binary: { secret, unreadable: {} } } }],
        sections: [
          {
            title: 'Security',
            fields: [
              { title: 'Token', id: 'raw-field-id', value: { binary: { secret, unreadable: {} } } },
            ],
          },
        ],
        passwordHistory: [{ value: secret }],
      },
    };
    const result = parseOnePassword(archive(exportData([affected])));
    expect(result.entries[0]).toMatchObject({ password: '', notes: '' });
    expect(result.entries[0].extraFields).toContainEqual({
      key: 'Password history',
      value: JSON.stringify([{ value: secret }]),
      metadata: {
        sourceKey: 'passwordHistory',
        sourceFieldType: 'json',
        sourceAutoMapping: 'manual-only',
      },
    });
    const { warnings, diagnostics } = result;
    expect(warnings).toEqual([
      'Item "Card", login field "Recovery code" was skipped.',
      'Item "Card", Security field "Token" was skipped.',
    ]);
    expect(warnings.join(' ')).not.toContain(secret);
    expect(warnings.join(' ')).not.toContain('raw-field-id');
    expect(JSON.stringify(diagnostics)).not.toContain(secret);
  });

  it('keeps a warning for every skipped field with the same label', () => {
    const affected = {
      ...item,
      details: {
        sections: [
          {
            title: 'Security',
            fields: [
              { title: 'Token', value: {} },
              { title: 'Token', value: {} },
            ],
          },
        ],
      },
    };
    expect(parseOnePassword(archive(exportData([affected]))).warnings).toEqual([
      'Item "Card", Security field "Token" was skipped.',
      'Item "Card", Security field "Token" was skipped.',
    ]);
  });

  it('does not warn about empty readable fields', () => {
    const affected = {
      ...item,
      details: {
        loginFields: [{ name: 'Empty', value: '' }],
        sections: [{ title: 'Details', fields: [{ title: 'Empty', value: '' }] }],
      },
    };
    expect(parseOnePassword(archive(exportData([affected]))).warnings).toEqual([]);
  });

  it('keeps structured email, address, and SSH text plus overview tags', () => {
    const structured = {
      ...item,
      overview: { ...item.overview, tags: ['important'] },
      details: {
        ...item.details,
        sections: [
          {
            title: 'Details',
            fields: [
              {
                title: 'email',
                value: { email: { email_address: 'a@example.com', provider: null } },
              },
              { title: 'address', value: { address: { street: 'Main', city: 'Lima' } } },
              {
                title: 'private key',
                value: { sshKey: { privateKey: 'key text', metadata: { keyType: 'RSA' } } },
              },
            ],
          },
        ],
      },
    };
    const entry = parseOnePassword(archive(exportData([structured]))).entries[0];
    expect(entry.tags).toEqual(['important']);
    expect(entry.extraFields).toContainEqual({
      key: 'Source tags',
      value: '["important"]',
      metadata: { sourceKey: 'tags', sourceFieldType: 'json', sourceAutoMapping: 'manual-only' },
    });
    expect(entry.extraFields.map(({ key, value }) => ({ key, value }))).toEqual(
      expect.arrayContaining([
        {
          key: 'Details: email',
          value: '{"email":{"email_address":"a@example.com","provider":null}}',
        },
        { key: 'Details: address', value: '{"address":{"street":"Main","city":"Lima"}}' },
        {
          key: 'Details: private key',
          value: '{"sshKey":{"privateKey":"key text","metadata":{"keyType":"RSA"}}}',
        },
      ]),
    );
  });

  it('rejects unsupported versions and malformed archives', () => {
    expect(() => parseOnePassword(archive({ accounts: [] }).slice(0, 10))).toThrow(
      VaultFormatError,
    );
    const badVersion = zipSync({
      'export.attributes': strToU8('{"version":4}'),
      'export.data': strToU8('{"accounts":[]}'),
    });
    expect(() =>
      parseOnePassword(
        badVersion.buffer.slice(
          badVersion.byteOffset,
          badVersion.byteOffset + badVersion.byteLength,
        ),
      ),
    ).toThrow('Unsupported');
  });

  it('rejects archive paths that escape the ZIP root', () => {
    expect(() => parseOnePassword(archive(exportData([]), { '../escape': strToU8('x') }))).toThrow(
      VaultFormatError,
    );
  });

  it('rejects malformed nested containers instead of silently losing other items', () => {
    expect(() => parseOnePassword(archive({ accounts: [{ vaults: 'not vaults' }] }))).toThrow(
      'vault list',
    );
    expect(() =>
      parseOnePassword(archive({ accounts: [{ vaults: [{ attrs: {}, items: 'not items' }] }] })),
    ).toThrow('item list');
    expect(() =>
      parseOnePassword(archive(exportData([item, { ...item, details: 'not details' }]))),
    ).toThrow('item details');
  });

  it('rejects malformed fields even when another item is valid', () => {
    const invalidSections = {
      ...item,
      details: { sections: [{ fields: { unexpected: 'secret' } }] },
    };
    const invalidField = { ...item, details: { sections: [{ fields: [null] }] } };
    const invalidLogin = { ...item, details: { loginFields: [null] } };
    expect(() => parseOnePassword(archive(exportData([item, invalidSections])))).toThrow(
      'section fields',
    );
    expect(() => parseOnePassword(archive(exportData([item, invalidField])))).toThrow(
      'section field',
    );
    expect(() => parseOnePassword(archive(exportData([item, invalidLogin])))).toThrow(
      'login field',
    );
  });

  it('rejects oversized inflation before decompression', () => {
    const oversized = archive(exportData([]), {
      'files/bomb': new Uint8Array(25 * 1024 * 1024 + 1),
    });
    expect(() => parseOnePassword(oversized)).toThrow(VaultFormatError);
  });

  it('rejects DEFLATE output larger than its declared size', () => {
    const bytes = new Uint8Array(archive(exportData([item])));
    const view = new DataView(bytes.buffer);
    for (let offset = 0; offset < bytes.length - 46; offset++) {
      if (view.getUint32(offset, true) !== 0x02014b50) continue;
      const nameLength = view.getUint16(offset + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      if (name !== 'export.data') continue;
      view.setUint32(offset + 24, 1, true);
      view.setUint32(view.getUint32(offset + 42, true) + 22, 1, true);
      break;
    }
    expect(() => parseOnePassword(bytes.buffer)).toThrow(VaultFormatError);
  });

  it.each([0, 6])('rejects changed JSON with a stale ZIP CRC at compression level %i', (level) => {
    const contents = (title: string) =>
      zipSync(
        {
          'export.attributes': strToU8(JSON.stringify({ version: 3, timestamp: 1 })),
          'export.data': strToU8(
            JSON.stringify(exportData([{ ...item, overview: { ...item.overview, title } }])),
          ),
        },
        { level },
      );
    const original = contents('Original');
    const changed = contents('Altered!');
    const crcOffset = (bytes: Uint8Array): number => {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let offset = 0; offset < bytes.length - 46; offset++) {
        if (view.getUint32(offset, true) !== 0x02014b50) continue;
        const length = view.getUint16(offset + 28, true);
        const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + length));
        if (name === 'export.data') return offset + 16;
      }
      throw new Error('Missing test ZIP member');
    };
    const originalView = new DataView(original.buffer, original.byteOffset, original.byteLength);
    const changedView = new DataView(changed.buffer, changed.byteOffset, changed.byteLength);
    changedView.setUint32(
      crcOffset(changed),
      originalView.getUint32(crcOffset(original), true),
      true,
    );
    expect(() =>
      parseOnePassword(
        changed.buffer.slice(changed.byteOffset, changed.byteOffset + changed.byteLength),
      ),
    ).toThrow('Could not decompress');
  });
  it('preserves unknown readable item properties under stable labels and reports omitted data', () => {
    const extra = {
      ...item,
      overview: { ...item.overview, 'new/hint': '  hint  ' },
      details: {
        ...item.details,
        custom: { flag: false, entries: [0, null] },
        binary: 'private-binary',
        passwordHistory: [{ value: 'private-history' }],
      },
    };
    const result = parseOnePassword(archive(exportData([extra])));
    expect(result.entries[0].extraFields.map(({ key, value }) => ({ key, value }))).toEqual(
      expect.arrayContaining([
        { key: 'overview/new~1hint', value: '  hint  ' },
        { key: 'details/custom', value: '{"flag":false,"entries":[0,null]}' },
      ]),
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'onepassword-password-history',
          kind: 'transformed',
          entryId: '0:0:source-item',
          count: 1,
        }),
        expect.objectContaining({
          code: 'onepassword-unreadable-properties',
          kind: 'unsupported',
          entryId: '0:0:source-item',
          count: 1,
        }),
      ]),
    );
    expect(JSON.stringify(result.diagnostics)).not.toContain('private-');
  });

  it('recovers readable siblings from mixed content and keeps JSON-looking strings literal', () => {
    const literal = '  {"file":"raw", "passkey":[]}  ';
    const result = parseOnePassword(
      archive(
        exportData([
          {
            ...item,
            details: {
              loginFields: [
                { designation: 'password', value: literal, fieldType: 'json' },
                {
                  name: 'Password candidate',
                  designation: 'password',
                  value: { custom: ['second'] },
                },
              ],
              sections: [
                {
                  title: 'Recovery',
                  fields: [
                    {
                      id: 'stable-field',
                      title: 'Mixed',
                      value: {
                        data: { file: 'reference text', flags: [false, 0] },
                        file: { documentId: 'private-document-id' },
                        passkeys: [{ credentialId: 'private-passkey-id' }],
                        nested: { binary: { value: 'private-binary-value' } },
                      },
                    },
                    {
                      title: 'Attachments only',
                      value: { attachments: [{ attachmentId: 'private-id' }] },
                    },
                  ],
                },
              ],
              extra: { file: 'benign literal', backup: { type: 'Buffer', data: [1, 2, 3] } },
            },
          },
        ]),
      ),
    );

    const [entry] = result.entries;
    expect(entry.password).toBe(literal);
    expect(entry.fieldMetadata?.password?.sourceFieldType).toBe('string');
    expect(entry.extraFields).toEqual(
      expect.arrayContaining([
        {
          key: 'Recovery: Mixed',
          value: '{"data":{"file":"reference text","flags":[false,0]}}',
          metadata: {
            sourceKey: 'stable-field',
            sourceSection: 'Recovery',
            sourceSectionIdentity: '0',
            sourceFieldType: 'json',
          },
        },
        expect.objectContaining({ key: 'details/extra', value: '{"file":"benign literal"}' }),
        expect.objectContaining({
          key: 'Password candidate',
          value: '{"custom":["second"]}',
          metadata: expect.objectContaining({ sourceFieldType: 'json' }),
        }),
      ]),
    );
    expect(entry.extraFields).toHaveLength(4);
    expect(result.warnings).toContain(
      'Item "Card", Recovery field "Attachments only" was skipped.',
    );
    expect(
      result.diagnostics?.filter(({ code }) => code === 'onepassword-partial-recovery'),
    ).toHaveLength(2);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'unsupported',
          message: 'Unsupported attachment content was omitted.',
        }),
        expect.objectContaining({
          kind: 'unsupported',
          message: 'Unsupported passkey content was omitted.',
        }),
        expect.objectContaining({
          kind: 'unsupported',
          message: 'Unsupported binary content was omitted.',
        }),
      ]),
    );
    expect(JSON.stringify(result.diagnostics)).not.toContain('private-');
  });

  it('preserves primary website labels and keeps alternative labels with their websites', () => {
    const result = parseOnePassword(
      archive(
        exportData([
          {
            ...item,
            overview: {
              ...item.overview,
              urls: [
                { url: item.overview.url, label: 'Console' },
                { url: item.overview.url, label: 'Console' },
                ...item.overview.urls,
              ],
            },
          },
        ]),
      ),
    );
    expect(result.entries[0].extraFields.slice(0, 2)).toEqual([
      {
        key: 'Primary URL label',
        value: 'Console',
        metadata: { sourceKey: 'label', sourceAutoMapping: 'manual-only' },
      },
      expect.objectContaining({ key: 'URL: other', value: 'https://other.example' }),
    ]);
  });

  it('retains source-level diagnostics when every item is file-only', () => {
    const result = parseOnePassword(
      archive(
        exportData([
          {
            uuid: 'file',
            overview: { title: 'Private filename' },
            details: { documentAttributes: {} },
          },
        ]),
        { 'files/attachment': strToU8('x') },
      ),
    );
    expect(result.entries).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'onepassword-attachments', count: 1 }),
        expect.objectContaining({
          code: 'onepassword-file-only-item',
          sourcePath: ['accounts', '0', 'vaults', '0', 'items', '0'],
          count: 1,
        }),
      ]),
    );
    expect(JSON.stringify(result.diagnostics)).not.toContain('Private filename');
  });
});
