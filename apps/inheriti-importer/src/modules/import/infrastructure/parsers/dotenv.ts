import { VaultFormatError, type ParseResult, type VaultEntry } from '@modules/import/domain/vault';
import type { ImportDiagnostic } from '@modules/import/domain/import-diagnostic';
import { decodeText, stripExtension } from './utils/secret-fields';

const LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=([\s\S]*)$/;

class DotenvParser {
  private readonly lines: string[];
  private readonly entries: Omit<VaultEntry, 'sourceId'>[] = [];
  private readonly diagnostics: ImportDiagnostic[] = [];
  private readonly group: string;

  constructor(
    data: ArrayBuffer,
    private readonly fileName: string,
  ) {
    this.lines = decodeText(data).split(/\r?\n/);
    this.group = stripExtension(fileName.replace(/^\./, '')) || fileName;
  }

  parse(): ParseResult {
    for (let index = 0; index < this.lines.length; index += 1) {
      index = this.parseLine(index);
    }
    if (this.entries.length === 0) {
      throw new VaultFormatError(
        'No environment variables were found. Import a .env file with KEY=value lines.',
      );
    }
    return {
      kind: 'dotenv',
      name: this.fileName.startsWith('.') ? this.fileName : stripExtension(this.fileName),
      entries: this.entries,
      warnings: [],
      diagnostics: this.diagnostics,
    };
  }

  private parseLine(index: number): number {
    const start = index;
    const line = this.lines[index].trimStart();
    if (!line || line.startsWith('#')) return index;

    const assignment = LINE.exec(line);
    if (!assignment) return this.skipMalformedLine(start);

    const [, key, rawValue] = assignment;
    const initial = rawValue.trimStart();
    if (rawValue !== initial && initial.startsWith('#')) return index;
    if (this.startsQuoted(initial)) {
      const quote = initial[0];
      if (this.closingQuoteAt(initial, quote, 1) < 0) {
        do {
          index++;
        } while (index < this.lines.length && this.closingQuoteAt(this.lines[index], quote) < 0);
        if (index === this.lines.length) return this.skipMalformedLine(start);
      }
    }
    const value = [initial, ...this.lines.slice(start + 1, index + 1)].join('\n');

    const text = this.unquote(value);
    if (text === undefined) return this.skipMalformedLine(start);
    this.addEntry(key, text);
    return index;
  }

  private skipMalformedLine(index: number): number {
    this.diagnostics.push({
      code: 'dotenv-malformed-line',
      kind: 'skipped',
      message: 'A malformed environment file line was skipped.',
      count: 1,
      sourcePath: [String(index + 1)],
    });
    return index;
  }

  private addEntry(key: string, value: string): void {
    if (!value) return;
    this.entries.push({
      id: crypto.randomUUID(),
      title: key,
      username: '',
      password: '',
      url: '',
      notes: '',
      group: this.group,
      tags: ['dotenv'],
      extraFields: [{ key, value }],
      category: '',
      team: '',
    });
  }

  private unquote(value: string): string | undefined {
    const trimmed = value.trim();
    if (this.startsQuoted(trimmed)) {
      const quote = trimmed[0];
      const closing = this.closingQuoteAt(trimmed, quote, 1);
      if (closing < 0 || !/^(?:\s+#.*)?$/.test(trimmed.slice(closing + 1))) return undefined;
      const text = trimmed.slice(1, closing);
      return quote === '"'
        ? text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"')
        : text;
    }
    const comment = trimmed.indexOf(' #');
    return (comment >= 0 ? trimmed.slice(0, comment) : trimmed).trim();
  }

  private startsQuoted(value: string): boolean {
    return /^["']/.test(value.trim());
  }

  private closingQuoteAt(text: string, quote: string, offset = 0): number {
    for (let index = offset; index < text.length; index += 1) {
      if (text[index] !== quote) continue;
      if (quote === "'") return index;
      // An escaped double quote does not end the value.
      let slashes = 0;
      for (let preceding = index - 1; preceding >= 0 && text[preceding] === '\\'; preceding -= 1) {
        slashes += 1;
      }
      if (slashes % 2 === 0) return index;
    }
    return -1;
  }
}

export function parseDotenv(data: ArrayBuffer, fileName = '.env'): ParseResult {
  return new DotenvParser(data, fileName).parse();
}
