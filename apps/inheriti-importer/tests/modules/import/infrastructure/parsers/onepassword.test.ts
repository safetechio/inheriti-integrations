import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseOnePassword } from '@modules/import/infrastructure/parsers/onepassword';
import { VaultFormatError } from '@modules/import/domain/vault';

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
    expect(result.entries[0].extraFields).toEqual([
      { key: 'URL: other', value: 'https://other.example' },
      { key: 'creditCardNumber', value: '4111' },
      { key: 'Payment: PIN', value: '1234' },
      { key: 'Payment: custom', value: 'first' },
      { key: 'Payment: custom (2)', value: 'second' },
    ]);
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
    const result = parseOnePassword(archive(exportData([fileOnly, mixed])));
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].notes).toBe('Keep this note');
    expect(result.warnings).toContain('File-only item "File" was skipped.');
    expect(result.warnings).toContain('File content in item "File" was skipped.');
  });

  it('identifies skipped fields and history without exposing values or archive identifiers', () => {
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
    const warnings = parseOnePassword(archive(exportData([affected]))).warnings;
    expect(warnings).toEqual([
      'Item "Card", login field "Recovery code" was skipped.',
      'Item "Card", Security field "Token" was skipped.',
      'Password history in item "Card" was skipped.',
    ]);
    expect(warnings.join(' ')).not.toContain(secret);
    expect(warnings.join(' ')).not.toContain('raw-field-id');
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
    expect(entry.extraFields).toEqual(
      expect.arrayContaining([
        { key: 'Details: email', value: 'a@example.com' },
        { key: 'Details: address', value: 'street: Main\ncity: Lima' },
        { key: 'Details: private key', value: 'privateKey: key text\nmetadata: RSA' },
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
});
