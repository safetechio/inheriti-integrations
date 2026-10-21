import { inflateSync } from 'fflate';
import { VaultFormatError, type ParseResult } from '@modules/import/domain/vault';
import { isFileOnly, mapItem } from './utils/onepassword-items';
import { hasValidCrc, validateOnePasswordZip, type ZipMember } from './utils/onepassword-zip';

type RecordValue = Record<string, unknown>;
const EXPORT_VERSION = 3;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): string => (typeof value === 'string' ? value : '');

class OnePasswordParser {
  private readonly entries: ParseResult['entries'] = [];
  private readonly warnings: string[] = [];
  private readonly entryIds = new Set<string>();

  constructor(
    private readonly data: ArrayBuffer,
    private readonly fileName: string,
  ) {}

  parse(): ParseResult {
    const accounts = this.readArchive();
    accounts.forEach((account, index) => this.readAccount(account, index));
    return {
      kind: 'onepassword',
      name: this.fileName.replace(/\.1pux$/i, ''),
      entries: this.entries,
      warnings: this.warnings,
    };
  }

  private readArchive(): unknown[] {
    // Only the export metadata and item data need decompression.
    const archive = validateOnePasswordZip(new Uint8Array(this.data));
    if (archive.attachmentCount) {
      const count = archive.attachmentCount;
      this.warnings.push(`${count} file attachment${count === 1 ? '' : 's'} skipped.`);
    }
    const attributes = this.readJson(archive.attributes);
    const exportData = this.readJson(archive.exportData);
    if (
      !record(attributes) ||
      attributes.version !== EXPORT_VERSION ||
      !record(exportData) ||
      !Array.isArray(exportData.accounts)
    ) {
      throw new VaultFormatError('Unsupported 1Password export version or structure.');
    }
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
    value.vaults.forEach((vault, index) => this.readVault(vault, accountIndex, index));
  }

  private readVault(value: unknown, accountIndex: number, vaultIndex: number): void {
    if (!record(value)) throw new VaultFormatError('Invalid 1Password vault.');
    if (!Array.isArray(value.items)) throw new VaultFormatError('Invalid 1Password item list.');
    const group = record(value.attrs) ? string(value.attrs.name) : '';
    value.items.forEach((item) => this.readItem(item, accountIndex, vaultIndex, group));
  }

  private readItem(value: unknown, accountIndex: number, vaultIndex: number, group: string): void {
    if (!record(value)) throw new VaultFormatError('Invalid 1Password item.');
    if (value.details != null && !record(value.details)) {
      throw new VaultFormatError('Invalid 1Password item details.');
    }
    if (isFileOnly(value)) {
      // File contents are outside the text asset import path.
      this.warnings.push(`File-only item "${this.itemTitle(value)}" was skipped.`);
      return;
    }
    if (value.file != null || (record(value.details) && value.details.documentAttributes != null)) {
      this.warnings.push(`File content in item "${this.itemTitle(value)}" was skipped.`);
    }
    const id = this.uniqueId(
      `${accountIndex}:${vaultIndex}:${string(value.uuid) || this.entries.length + 1}`,
    );
    this.entries.push(mapItem(value, id, group, this.warnings));
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
