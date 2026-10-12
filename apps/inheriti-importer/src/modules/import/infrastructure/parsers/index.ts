import { detectVaultKind } from './detect';
import { parseCloud } from './cloud';
import { parseDotenv } from './dotenv';
import { parseKeepass } from './keepass';
import { parseKubernetes } from './kubernetes';
import { parsePassbolt } from './passbolt';
import { parseVault } from './vault';
import { VaultFormatError, type ParseResult } from '@modules/import/domain/vault';
import {
  assertWithinFileSize,
  assertWithinStructureLimits,
} from '@modules/import/domain/import-guards';

export async function parseVaultFile(
  data: ArrayBuffer,
  fileName: string,
  secrets: { password?: string; keyFile?: ArrayBuffer } = {},
): Promise<ParseResult> {
  assertWithinFileSize(data.byteLength);
  const kind = detectVaultKind(fileName, data);

  const parse = async (): Promise<ParseResult> => {
    if (kind === 'keepass') return parseKeepass(data, { ...secrets, fileName });
    if (kind === 'passbolt') return parsePassbolt(data, fileName);
    if (kind === 'kubernetes') return parseKubernetes(data, fileName);
    if (kind === 'vault') return parseVault(data, fileName);
    if (kind === 'dotenv') return parseDotenv(data, fileName);
    if (kind === 'cloud') return parseCloud(data, fileName);
    throw new VaultFormatError(`Unsupported vault type for “${fileName}”.`);
  };

  const result = await parse();
  assertWithinStructureLimits({
    entryCount: result.entries.length,
    maxDepth: result.entries.reduce(
      (depth, entry) => Math.max(depth, entry.group.split(/[/.\\\\]/).filter(Boolean).length),
      0,
    ),
    maxFieldsPerEntry: result.entries.reduce(
      (count, entry) => Math.max(count, 5 + entry.extraFields.length),
      0,
    ),
  });
  return result;
}

export { parseCloud } from './cloud';
export { parseDotenv } from './dotenv';
export { parseKeepass } from './keepass';
export { parseKubernetes } from './kubernetes';
export { parsePassbolt } from './passbolt';
export { parseVault } from './vault';
