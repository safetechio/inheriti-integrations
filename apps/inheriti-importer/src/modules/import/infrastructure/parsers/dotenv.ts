import { VaultFormatError, type ParseResult, type VaultEntry } from '@modules/import/domain/vault';
import { decodeText, stripExtension } from './utils/secret-fields';

const LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*)$/;

class DotenvParser {
  private readonly lines: string[];
  private readonly entries: Omit<VaultEntry, 'sourceId'>[] = [];
  private readonly warnings: string[] = [];
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
      warnings: this.warnings,
    };
  }

  private parseLine(index: number): number {
    let line = this.lines[index].trim();
    if (!line || line.startsWith('#')) return index;

    const assignment = LINE.exec(line);
    if (assignment && this.startsQuoted(assignment[2]) && !this.hasClosingQuote(assignment[2])) {
      while (index + 1 < this.lines.length) {
        index += 1;
        line += `\n${this.lines[index]}`;
        if (this.hasClosingQuote(line.slice(line.indexOf('=') + 1))) break;
      }
    }

    const match = LINE.exec(line);
    if (!match) {
      if (line.includes('=')) this.warnings.push(`Could not parse line ${index + 1}.`);
      return index;
    }
    this.addEntry(match[1], this.unquote(match[2]));
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

  private unquote(value: string): string {
    const trimmed = value.trim();
    const quoted = trimmed.match(/^(['"])([\s\S]*?)\1(?:\s+#.*)?$/);
    if (quoted) {
      return quoted[1] === '"'
        ? quoted[2].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"')
        : quoted[2];
    }
    const comment = trimmed.indexOf(' #');
    return (comment >= 0 ? trimmed.slice(0, comment) : trimmed).trim();
  }

  private startsQuoted(value: string): boolean {
    return /^["']/.test(value.trim());
  }

  private hasClosingQuote(value: string): boolean {
    const trimmed = value.trim();
    const quote = trimmed[0];
    if (quote !== '"' && quote !== "'") return true;
    for (let index = 1; index < trimmed.length; index += 1) {
      if (trimmed[index] !== quote) continue;
      if (quote === "'") return true;
      // An escaped double quote does not end the value.
      let slashes = 0;
      for (
        let preceding = index - 1;
        preceding >= 0 && trimmed[preceding] === '\\';
        preceding -= 1
      ) {
        slashes += 1;
      }
      if (slashes % 2 === 0) return true;
    }
    return false;
  }
}

export function parseDotenv(data: ArrayBuffer, fileName = '.env'): ParseResult {
  return new DotenvParser(data, fileName).parse();
}
