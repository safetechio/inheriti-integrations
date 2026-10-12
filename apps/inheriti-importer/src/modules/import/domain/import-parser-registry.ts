import type { ImportParser, ParsedImportSource } from '@modules/import/domain/import-parser';

/**
 * Ordered detection registry. Parsers are tried in registration
 * order; the first whose `canParse` returns true handles the file.
 */
export class ImportParserRegistry {
  #parsers: ImportParser[] = [];

  register(parser: ImportParser): this {
    this.#parsers.push(parser);
    return this;
  }

  resolve(fileName: string, data: ArrayBuffer): ImportParser | undefined {
    return this.#parsers.find((parser) => {
      try {
        return parser.canParse(fileName, data);
      } catch {
        return false;
      }
    });
  }

  async parse(
    fileName: string,
    data: ArrayBuffer,
    secrets?: { password?: string; keyFile?: ArrayBuffer },
  ): Promise<ParsedImportSource> {
    const parser = this.resolve(fileName, data);
    if (!parser) {
      throw new ImportFormatError(`No importer recognised "${fileName}".`);
    }
    return parser.parse({ data, fileName, secrets });
  }
}

export class ImportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFormatError';
  }
}
