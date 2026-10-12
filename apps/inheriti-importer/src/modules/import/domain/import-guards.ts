/**
 * Adversarial-input limits — guards against a malicious or oversized source
 * file exhausting memory before it ever reaches a parser. Checked before a
 * file is handed to any parser.
 */
export interface ImportLimits {
  maxFileBytes: number;
  maxEntriesPerSource: number;
  maxGroupDepth: number;
  maxFieldsPerEntry: number;
}

export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  maxFileBytes: 25 * 1024 * 1024,
  maxEntriesPerSource: 5000,
  maxGroupDepth: 32,
  maxFieldsPerEntry: 200,
};

export class ImportLimitExceededError extends Error {
  constructor(
    public readonly limit: keyof ImportLimits,
    message: string,
  ) {
    super(message);
    this.name = 'ImportLimitExceededError';
  }
}

export function assertWithinFileSize(
  byteLength: number,
  limits: ImportLimits = DEFAULT_IMPORT_LIMITS,
): void {
  if (byteLength > limits.maxFileBytes) {
    throw new ImportLimitExceededError(
      'maxFileBytes',
      `File is ${(byteLength / (1024 * 1024)).toFixed(1)} MB; the limit is ${(
        limits.maxFileBytes /
        (1024 * 1024)
      ).toFixed(0)} MB.`,
    );
  }
}

export function assertWithinStructureLimits(
  stats: { entryCount: number; maxDepth: number; maxFieldsPerEntry: number },
  limits: ImportLimits = DEFAULT_IMPORT_LIMITS,
): void {
  if (stats.entryCount > limits.maxEntriesPerSource) {
    throw new ImportLimitExceededError(
      'maxEntriesPerSource',
      `Source has ${stats.entryCount} entries; the limit is ${limits.maxEntriesPerSource}.`,
    );
  }
  if (stats.maxDepth > limits.maxGroupDepth) {
    throw new ImportLimitExceededError(
      'maxGroupDepth',
      `Group nesting is ${stats.maxDepth} deep; the limit is ${limits.maxGroupDepth}.`,
    );
  }
  if (stats.maxFieldsPerEntry > limits.maxFieldsPerEntry) {
    throw new ImportLimitExceededError(
      'maxFieldsPerEntry',
      `An entry has ${stats.maxFieldsPerEntry} fields; the limit is ${limits.maxFieldsPerEntry}.`,
    );
  }
}
