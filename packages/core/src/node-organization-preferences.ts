import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function readOrganizationPreferences(path: string): Promise<Record<string, string>> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)
      && Object.values(value).every((id) => typeof id === 'string')) return value as Record<string, string>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
  }
  throw Object.assign(new Error('organization_preference_invalid'), { code: 'organization_preference_invalid' });
}

export async function saveOrganizationPreferences(path: string, selections: Record<string, string>): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(`${path}.tmp-`);
  try {
    const temporary = join(directory, 'preferences.json');
    await writeFile(temporary, JSON.stringify(selections), { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
