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

  it('diagnoses malformed lines without exposing content or adding empty secrets', () => {
    const result = parseDotenv(
      buffer('private malformed text\nBAD="unterminated\nGOOD=valid\nEMPTY=\n'),
    );

    expect(result.entries.map(({ title }) => title)).toEqual(['GOOD']);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'dotenv-malformed-line', count: 1, sourcePath: ['1'] }),
      expect.objectContaining({ code: 'dotenv-malformed-line', count: 1, sourcePath: ['2'] }),
    ]);
    expect(JSON.stringify(result.diagnostics)).not.toContain('private');
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

  it('preserves trailing spaces on the opening line of both quote styles', () => {
    const result = parseDotenv(buffer(`DOUBLE="first  \nsecond"\nSINGLE='first  \nsecond'\n`));

    expect(result.entries.map((entry) => entry.extraFields[0]?.value)).toEqual([
      'first  \nsecond',
      'first  \nsecond',
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
