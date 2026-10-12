import { describe, expect, it } from 'vitest';
import { parseDotenv } from '@modules/import/infrastructure/parsers/dotenv';

function buffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

describe('parseDotenv', () => {
  it('reads KEY=value lines, quotes, and comments', () => {
    const result = parseDotenv(
      buffer(`# app secrets
DATABASE_URL=postgres://ada:s3cret@db/app
export API_KEY="abc 123"
EMPTY=
HOST=example.com # trailing comment
`),
      '.env',
    );

    expect(result.kind).toBe('dotenv');
    expect(result.entries.map((entry) => [entry.title, entry.password, entry.extraFields])).toEqual(
      [
        ['DATABASE_URL', '', [{ key: 'DATABASE_URL', value: 'postgres://ada:s3cret@db/app' }]],
        ['API_KEY', '', [{ key: 'API_KEY', value: 'abc 123' }]],
        ['HOST', '', [{ key: 'HOST', value: 'example.com' }]],
      ],
    );
  });

  it('reads inline comments and multiline quoted values', () => {
    const result = parseDotenv(
      buffer('MESSAGE="hello # team" # comment\nCERT="line one\nline two"\n'),
      '.env',
    );

    expect(result.entries.map((entry) => entry.extraFields[0]?.value)).toEqual([
      'hello # team',
      'line one\nline two',
    ]);
  });

  it('handles escaped quote parity and literal backslashes in single quotes', () => {
    const result = parseDotenv(
      buffer(`EVEN="ends\\\\"
SINGLE='ends\\'
NEXT=ok
`),
      '.env',
    );

    expect(result.entries.map((entry) => entry.title)).toEqual(['EVEN', 'SINGLE', 'NEXT']);
  });
});
