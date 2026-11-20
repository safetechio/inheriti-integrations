import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseVaultFile } from '@modules/import/infrastructure/parsers';

interface Fixture {
  format: string;
  bytes: number;
  sha256: string;
  expectedEntries?: number;
  expectedError?: string;
  checks?: { title: string; field: string; sha256: string }[];
  omitted?: { title: string; scope: string; reason: string }[];
}

const directory = resolve(process.cwd(), 'tests/fixtures/sample-imports/realistic');
const { files }: { files: Record<string, Fixture> } = JSON.parse(
  readFileSync(resolve(directory, 'manifest.json'), 'utf8'),
);
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

describe('realistic synthetic import fixtures', () => {
  it.each(Object.entries(files))('matches the manifest for %s', async (name, fixture) => {
    const bytes = readFileSync(resolve(directory, name));
    expect(bytes).toHaveLength(fixture.bytes);
    expect(digest(bytes)).toBe(fixture.sha256);

    const data = Uint8Array.from(bytes).buffer;
    if (fixture.expectedEntries === undefined) {
      if (fixture.expectedError) {
        await expect(parseVaultFile(data, name)).rejects.toThrow(fixture.expectedError);
      }
      return;
    }

    const result = await parseVaultFile(data, name);
    expect(result.kind).toBe(fixture.format);
    expect(result.entries).toHaveLength(fixture.expectedEntries);
    expect(new Set(result.entries.map(({ id }) => id)).size).toBe(result.entries.length);
    for (const check of fixture.checks ?? []) {
      const entry = result.entries.find(({ title }) => title === check.title);
      const value =
        check.field === 'password' || check.field === 'notes'
          ? entry?.[check.field]
          : entry?.extraFields.find(({ key }) => key === check.field)?.value;

      expect(typeof value, `${check.title}: ${check.field}`).toBe('string');
      expect(digest(value ?? ''), `${check.title}: ${check.field}`).toBe(check.sha256);
    }
    for (const { title, scope } of fixture.omitted ?? []) {
      expect(result.entries.some((entry) => entry.title === title)).toBe(scope !== 'entry');
      expect(result.warnings.some((warning) => warning.includes(title))).toBe(true);
    }
  });
});
