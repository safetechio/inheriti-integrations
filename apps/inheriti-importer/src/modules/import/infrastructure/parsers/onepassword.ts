import type { ImportDiagnostic } from '@modules/import/domain/import-diagnostic';
import { decodeText } from './utils/secret-fields';
import { isOnePasswordCsv, parseOnePasswordCsv } from './utils/onepassword-csv';
import { inflateSync } from 'fflate';
import { VaultFormatError, type ParseResult } from '@modules/import/domain/vault';
import { mapItem } from './utils/onepassword-items';
import { hasValidCrc, validateOnePasswordZip, type ZipMember } from './utils/onepassword-zip';

type RecordValue = Record<string, unknown>;
const EXPORT_VERSION = 3;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): string => (typeof value === 'string' ? value : '');

class OnePasswordParser {
  private readonly entries: ParseResult['entries'] = [];
  private readonly warnings: string[] = [];
  private readonly diagnostics: ImportDiagnostic[] = [];
  private readonly entryIds = new Set<string>();

  constructor(
    private readonly data: ArrayBuffer,
    private readonly fileName: string,
  ) {}

  parse(): ParseResult {
    if (this.data.byteLength < 4 || new DataView(this.data).getUint32(0, true) !== 0x04034b50) {
      const text = decodeText(this.data);
      if (!this.fileName.toLowerCase().endsWith('.1pux') && isOnePasswordCsv(text)) {
        return parseOnePasswordCsv(text, this.fileName);
      }
    }
    const accounts = this.readArchive();
    accounts.forEach((account, index) => this.readAccount(account, index));
    return {
      kind: 'onepassword',
      name: this.fileName.replace(/\.1pux$/i, ''),
      entries: this.entries,
      warnings: this.warnings,
      diagnostics: this.diagnostics,
    };
  }

  private readArchive(): unknown[] {
    // Only the export metadata and item data need decompression.
    const archive = validateOnePasswordZip(new Uint8Array(this.data));
    if (archive.attachmentCount) {
      const count = archive.attachmentCount;
      this.warnings.push(`${count} file attachment${count === 1 ? '' : 's'} skipped.`);
      this.diagnostics.push({
        code: 'onepassword-attachments',
        kind: 'unsupported',
        message: 'File attachments were skipped.',
        count,
        sourcePath: ['files'],
      });
    }
    const attributes = this.readJson(archive.attributes);
    if (!record(attributes) || attributes.version !== EXPORT_VERSION) {
      throw new VaultFormatError(
        'Unsupported 1Password export version. Only 1PUX version 3 is supported.',
      );
    }
    const exportData = this.readJson(archive.exportData);
    if (!record(exportData) || !Array.isArray(exportData.accounts)) {
      throw new VaultFormatError('Invalid 1Password export: expected an accounts list.');
    }
    this.reportMetadata(attributes, ['version'], ['export.attributes']);
    this.reportMetadata(exportData, ['accounts'], ['export.data']);
    return exportData.accounts;
  }

  private readJson(member: ZipMember): unknown {
    let bytes: Uint8Array;
    try {
      bytes = this.extractMember(member);
    } catch {
      throw new VaultFormatError('Could not decompress the 1Password archive.');
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new VaultFormatError('The 1Password archive contains invalid JSON.');
    }
  }

  private extractMember(member: ZipMember): Uint8Array {
    // A fixed output buffer prevents a forged ZIP size from growing inflation memory.
    const output =
      member.method === 0 ? member.data : inflateSync(member.data, new Uint8Array(member.size + 1));
    if (output.length !== member.size || !hasValidCrc(output, member.crc)) {
      throw new Error('ZIP member integrity mismatch');
    }
    return output;
  }

  private readAccount(value: unknown, accountIndex: number): void {
    if (!record(value)) throw new VaultFormatError('Invalid 1Password account.');
    if (!Array.isArray(value.vaults)) throw new VaultFormatError('Invalid 1Password vault list.');
    this.reportMetadata(value, ['vaults'], ['accounts', String(accountIndex)]);
    value.vaults.forEach((vault, index) => this.readVault(vault, accountIndex, index));
  }

  private readVault(value: unknown, accountIndex: number, vaultIndex: number): void {
    if (!record(value)) throw new VaultFormatError('Invalid 1Password vault.');
    if (!Array.isArray(value.items)) throw new VaultFormatError('Invalid 1Password item list.');
    const group = record(value.attrs) ? string(value.attrs.name) : '';
    const path = ['accounts', String(accountIndex), 'vaults', String(vaultIndex)];
    this.reportMetadata(value, ['items', 'attrs'], path);
    if (record(value.attrs)) this.reportMetadata(value.attrs, ['name'], [...path, 'attrs']);
    value.items.forEach((item, index) =>
      this.readItem(item, accountIndex, vaultIndex, index, group),
    );
  }

  private readItem(
    value: unknown,
    accountIndex: number,
    vaultIndex: number,
    index: number,
    group: string,
  ): void {
    if (!record(value)) throw new VaultFormatError('Invalid 1Password item.');
    if (value.details != null && !record(value.details)) {
      throw new VaultFormatError('Invalid 1Password item details.');
    }
    const sourcePath = [
      'accounts',
      String(accountIndex),
      'vaults',
      String(vaultIndex),
      'items',
      String(index),
    ];
    const id = this.uniqueId(`${accountIndex}:${vaultIndex}:${string(value.uuid) || index + 1}`);
    const entry = mapItem(value, id, group, this.warnings, this.diagnostics);
    const hasFile =
      value.file != null || (record(value.details) && value.details.documentAttributes != null);
    const hasReadableContent =
      entry.username || entry.password || entry.url || entry.notes || entry.extraFields.length;
    if (hasFile && !hasReadableContent) {
      // File contents are outside the text asset import path.
      this.warnings.push(`File-only item "${this.itemTitle(value)}" was skipped.`);
      this.diagnostics.push({
        code: 'onepassword-file-only-item',
        kind: 'skipped',
        message: 'A file-only item was skipped.',
        count: 1,
        sourcePath,
      });
      return;
    }
    if (hasFile) {
      this.warnings.push(`File content in item "${this.itemTitle(value)}" was skipped.`);
      this.diagnostics.push({
        code: 'onepassword-item-file',
        kind: 'unsupported',
        message: 'Item file content was skipped.',
        count: 1,
        entryId: id,
        sourcePath,
      });
    }
    this.entries.push(entry);
  }

  private reportMetadata(owner: RecordValue, consumed: string[], sourcePath: string[]): void {
    const count = Object.keys(owner).filter((key) => !consumed.includes(key)).length;
    if (count)
      this.diagnostics.push({
        code: 'onepassword-container-metadata',
        kind: 'skipped',
        message: 'Export, account, or vault metadata was omitted.',
        count,
        sourcePath,
      });
  }

  private itemTitle(item: RecordValue): string {
    return record(item.overview) ? string(item.overview.title) || 'Untitled' : 'Untitled';
  }

  private uniqueId(sourceId: string): string {
    // Exported item UUIDs can repeat across vaults or malformed exports.
    let id = sourceId;
    for (let suffix = 2; this.entryIds.has(id); suffix++) id = `${sourceId}:${suffix}`;
    this.entryIds.add(id);
    return id;
  }
}

export function parseOnePassword(
  data: ArrayBuffer,
  fileName = '1Password export.1pux',
): ParseResult {
  return new OnePasswordParser(data, fileName).parse();
}
