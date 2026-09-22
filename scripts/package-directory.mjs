import { realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * Finds an installed package's real directory by walking up from a starting point.
 *
 * The hosts need files from inside the SDKs — Core's SSDP worker has to be copied beside the bundle —
 * and the packages are ESM-only, so `require.resolve` cannot see their `exports`. Walking is what is
 * left, and it has to survive both layouts: a `link:` dependency resolves to a checkout whose own
 * `node_modules` sits one level up, while an installed one lives in pnpm's store, where a package's
 * dependencies are its siblings rather than its children. Ascending finds it either way.
 */
export async function packageDirectory(fromDirectory, name) {
  const segments = name.split('/');
  let directory = await realpath(fromDirectory);
  for (;;) {
    try {
      return await realpath(resolve(directory, 'node_modules', ...segments));
    } catch {
      // Not at this level; try the parent.
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`could_not_locate_package: ${name} from ${fromDirectory}`);
    directory = parent;
  }
}
