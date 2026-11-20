import Papa from 'papaparse';
import { VaultFormatError, type ParseResult } from '@modules/import/domain/vault';

const FIELD_ORDER = [
  'title',
  'website',
  'username',
  'password',
  'otp',
  'favorite',
  'archived',
  'tags',
  'notes',
];

function normalizeHeader(header: string): string {
  const key = header.trim().toLowerCase();
  if (key === 'url') return 'website';
  if (['otp', 'otpauth', 'one-time password'].includes(key)) return 'otp';
  if (['favorites', 'favorite status'].includes(key)) return 'favorite';
  if (key === 'archived status') return 'archived';
  return key;
}

export function isOnePasswordCsv(text: string): boolean {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const {
    data: [columns],
  } = Papa.parse<string[]>(firstLine, { delimiter: ',' });
  return (
    columns?.length === FIELD_ORDER.length &&
    columns.map(normalizeHeader).every((column, index) => column === FIELD_ORDER[index])
  );
}

export function parseOnePasswordCsv(text: string, fileName: string): ParseResult {
  const result = Papa.parse<string[]>(text, { delimiter: ',', skipEmptyLines: true });
  const rows = result.data.slice(1);
  if (result.errors.length || rows.some((row) => row.length !== FIELD_ORDER.length)) {
    throw new VaultFormatError('The 1Password CSV has malformed or incomplete rows.');
  }
  if (!rows.length) throw new VaultFormatError('The 1Password CSV contains no items.');
  return {
    kind: 'onepassword',
    name: fileName.replace(/\.csv$/i, ''),
    entries: rows.map(
      ([title, url, username, password, otp, favorite, archived, tags, notes], index) => ({
        id: `csv:${index + 1}`,
        title: title || `Untitled ${index + 1}`,
        username,
        password,
        url,
        notes,
        group: '',
        tags: tags
          ? tags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean)
          : [],
        extraFields: [
          { key: 'OTPAuth', value: otp },
          { key: 'Favorite', value: favorite },
          { key: 'Archived', value: archived },
          { key: 'Tags', value: tags },
        ].filter(({ value }) => value !== ''),
        category: '',
        team: '',
      }),
    ),
    warnings: [],
  };
}
