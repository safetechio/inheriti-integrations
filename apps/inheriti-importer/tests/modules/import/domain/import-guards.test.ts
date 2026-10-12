import { describe, expect, it } from 'vitest';
import {
  assertWithinFileSize,
  assertWithinStructureLimits,
  ImportLimitExceededError,
} from '@modules/import/domain/import-guards';

describe('import input guards', () => {
  it('rejects files larger than the configured byte limit', () => {
    expect(() =>
      assertWithinFileSize(11, {
        maxFileBytes: 10,
        maxEntriesPerSource: 10,
        maxGroupDepth: 3,
        maxFieldsPerEntry: 5,
      }),
    ).toThrow(ImportLimitExceededError);
  });

  it('rejects excessive entry counts, nesting, and fields', () => {
    expect(() =>
      assertWithinStructureLimits(
        { entryCount: 11, maxDepth: 1, maxFieldsPerEntry: 1 },
        { maxFileBytes: 100, maxEntriesPerSource: 10, maxGroupDepth: 3, maxFieldsPerEntry: 5 },
      ),
    ).toThrow(/entries/);

    expect(() =>
      assertWithinStructureLimits(
        { entryCount: 1, maxDepth: 4, maxFieldsPerEntry: 1 },
        { maxFileBytes: 100, maxEntriesPerSource: 10, maxGroupDepth: 3, maxFieldsPerEntry: 5 },
      ),
    ).toThrow(/nesting/);

    expect(() =>
      assertWithinStructureLimits(
        { entryCount: 1, maxDepth: 1, maxFieldsPerEntry: 6 },
        { maxFileBytes: 100, maxEntriesPerSource: 10, maxGroupDepth: 3, maxFieldsPerEntry: 5 },
      ),
    ).toThrow(/fields/);
  });
});
