import { VaultFormatError, type ParseResult, type VaultEntry } from '@modules/import/domain/vault';
import { decodeText, stripExtension } from './secret-fields';

const LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*)$/;

export function parseDotenv(data: ArrayBuffer, fileName = '.env'): ParseResult {
  const text = decodeText(data);
  const warnings: string[] = [];
  const group = stripExtension(fileName.replace(/^\./, '')) || fileName;
  const entries: Omit<VaultEntry, 'sourceId'>[] = [];

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index].trim();
    if (!line || line.startsWith('#')) continue;

    const assignment = LINE.exec(line);
    if (assignment && startsQuoted(assignment[2]) && !hasClosingQuote(assignment[2])) {
      while (index + 1 < lines.length) {
        index += 1;
        line += `\n${lines[index]}`;
        if (hasClosingQuote(line.slice(line.indexOf('=') + 1))) break;
      }
    }

    const match = LINE.exec(line);
    if (!match) {
      if (line.includes('=')) {
        warnings.push(`Could not parse line ${index + 1}.`);
      }
      continue;
    }

    const key = match[1];
    const value = unquote(match[2]);
    if (!value) continue;
    entries.push({
      id: crypto.randomUUID(),
      title: key,
      username: '',
      password: '',
      url: '',
      notes: '',
      group,
      tags: ['dotenv'],
      extraFields: [{ key, value }],
      category: '',
      team: '',
    });
  }

  if (entries.length === 0) {
    throw new VaultFormatError(
      'No environment variables were found. Import a .env file with KEY=value lines.',
    );
  }

  return {
    kind: 'dotenv',
    name: fileName.startsWith('.') ? fileName : stripExtension(fileName),
    entries,
    warnings,
  };
}

function unquote(value: string): string {
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

function startsQuoted(value: string): boolean {
  return /^["']/.test(value.trim());
}

function hasClosingQuote(value: string): boolean {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'") return true;
  for (let index = 1; index < trimmed.length; index += 1) {
    if (trimmed[index] !== quote) continue;
    if (quote === "'") return true;
    let slashes = 0;
    for (let preceding = index - 1; preceding >= 0 && trimmed[preceding] === '\\'; preceding -= 1) {
      slashes += 1;
    }
    if (slashes % 2 === 0) return true;
  }
  return false;
}
