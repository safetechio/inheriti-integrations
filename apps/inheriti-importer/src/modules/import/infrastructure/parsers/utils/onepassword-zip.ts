import { VaultFormatError } from '@modules/import/domain/vault';

const END_SIGNATURE = 0x06054b50;
const DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const STORED_METHOD = 0;
const DEFLATE_METHOD = 8;
const ATTRIBUTES_MEMBER = 'export.attributes';
const DATA_MEMBER = 'export.data';
const MAX_MEMBERS = 1000;
const MAX_UNCOMPRESSED = 50 * 1024 * 1024;
const MAX_MEMBER = 25 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
export type ZipMember = { data: Uint8Array; method: number; size: number; crc: number };

class ZipCrc {
  private static readonly table = Uint32Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });

  static verify(data: Uint8Array, expected: number): boolean {
    let crc = 0xffffffff;
    for (const byte of data) crc = this.table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0 === expected;
  }
}

export function hasValidCrc(data: Uint8Array, expected: number): boolean {
  return ZipCrc.verify(data, expected);
}

class OnePasswordZipValidator {
  private readonly view: DataView;

  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  private findDirectoryEnd(): number {
    const { data, view } = this;
    for (let pos = data.length - 22; pos >= Math.max(0, data.length - 65557); pos--) {
      if (view.getUint32(pos, true) === END_SIGNATURE) return pos;
    }
    throw new VaultFormatError('Invalid 1Password ZIP directory.');
  }

  private readHeader(position: number, end: number) {
    const { data, view } = this;
    if (position + 46 > end || view.getUint32(position, true) !== DIRECTORY_SIGNATURE)
      throw new Error();
    const nameLength = view.getUint16(position + 28, true);
    const next =
      position +
      46 +
      nameLength +
      view.getUint16(position + 30, true) +
      view.getUint16(position + 32, true);
    if (next > end) throw new Error();
    return {
      flags: view.getUint16(position + 8, true),
      method: view.getUint16(position + 10, true),
      crc: view.getUint32(position + 16, true),
      compressed: view.getUint32(position + 20, true),
      size: view.getUint32(position + 24, true),
      offset: view.getUint32(position + 42, true),
      name: decoder.decode(data.subarray(position + 46, position + 46 + nameLength)),
      next,
    };
  }

  private validateHeader(header: ReturnType<OnePasswordZipValidator['readHeader']>): void {
    const { name, flags, method, compressed, size } = header;
    const segments = name.split('/');
    if (
      !name ||
      name.startsWith('/') ||
      name.includes('\\') ||
      segments.includes('..') ||
      segments.includes('.') ||
      /^[A-Za-z]:/.test(name)
    )
      throw new Error();
    if (
      flags & 1 ||
      ![STORED_METHOD, DEFLATE_METHOD].includes(method) ||
      compressed === 0xffffffff ||
      size === 0xffffffff ||
      compressed > MAX_MEMBER ||
      size > MAX_MEMBER ||
      (method === STORED_METHOD && compressed !== size) ||
      (size > 0 && compressed === 0)
    )
      throw new Error();
  }

  /** Checks the local header before exposing a compressed member slice. */
  private readLocalData(
    header: ReturnType<OnePasswordZipValidator['readHeader']>,
    position: number,
  ): Uint8Array {
    const { data, view } = this;
    const { offset, name, method, compressed, size, flags } = header;
    if (offset + 30 > position || view.getUint32(offset, true) !== LOCAL_SIGNATURE)
      throw new Error();
    const localNameLength = view.getUint16(offset + 26, true);
    const localExtraLength = view.getUint16(offset + 28, true);
    const localName = decoder.decode(data.subarray(offset + 30, offset + 30 + localNameLength));
    const dataEnd = offset + 30 + localNameLength + localExtraLength + compressed;
    if (localName !== name || view.getUint16(offset + 8, true) !== method || dataEnd > position)
      throw new Error();
    if (
      !(flags & 8) &&
      (view.getUint32(offset + 18, true) !== compressed ||
        view.getUint32(offset + 22, true) !== size)
    )
      throw new Error();
    return data.subarray(dataEnd - compressed, dataEnd);
  }

  private readMember(position: number, end: number) {
    const header = this.readHeader(position, end);
    this.validateHeader(header);
    const data = this.readLocalData(header, position);
    return {
      name: header.name,
      size: header.size,
      method: header.method,
      crc: header.crc,
      data,
      next: header.next,
    };
  }

  private directoryBounds() {
    const { data, view } = this;
    const end = this.findDirectoryEnd();
    if (end + 22 + view.getUint16(end + 20, true) !== data.length) {
      throw new VaultFormatError('Invalid 1Password ZIP directory.');
    }
    const count = view.getUint16(end + 10, true);
    const directorySize = view.getUint32(end + 12, true);
    const position = view.getUint32(end + 16, true);
    if (
      count === 0 ||
      count > MAX_MEMBERS ||
      directorySize === 0xffffffff ||
      position + directorySize !== end
    ) {
      throw new VaultFormatError('1Password ZIP exceeds archive limits.');
    }
    return { end, count, position };
  }

  validate(): { attachmentCount: number; attributes: ZipMember; exportData: ZipMember } {
    const { end, count, position } = this.directoryBounds();
    try {
      return this.collectMembers(position, end, count);
    } catch {
      throw new VaultFormatError('Invalid or unsafe 1Password ZIP archive.');
    }
  }

  private collectMembers(
    start: number,
    end: number,
    count: number,
  ): { attachmentCount: number; attributes: ZipMember; exportData: ZipMember } {
    const names = new Set<string>();
    let attributes: ZipMember | undefined;
    let exportData: ZipMember | undefined;
    let total = 0;
    let position = start;
    for (let index = 0; index < count; index++) {
      const member = this.readMember(position, end);
      if (names.has(member.name)) throw new Error();
      names.add(member.name);
      if (member.name === ATTRIBUTES_MEMBER) attributes = member;
      if (member.name === DATA_MEMBER) exportData = member;
      total += member.size;
      if (total > MAX_UNCOMPRESSED) throw new Error();
      position = member.next;
    }
    if (position !== end || !attributes || !exportData) throw new Error();
    return {
      attachmentCount: [...names].filter((name) => name.startsWith('files/') && !name.endsWith('/'))
        .length,
      attributes,
      exportData,
    };
  }
}

export function validateOnePasswordZip(data: Uint8Array): {
  attachmentCount: number;
  attributes: ZipMember;
  exportData: ZipMember;
} {
  return new OnePasswordZipValidator(data).validate();
}
