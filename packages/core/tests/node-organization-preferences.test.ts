import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readOrganizationPreferences, saveOrganizationPreferences } from '../src/node-organization-preferences.js';

it('persists private preferences and rejects malformed selections', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'organization-preferences-'));
  const path = join(directory, 'nested', 'organizations.json');
  try {
    expect(await readOrganizationPreferences(path)).toEqual({});
    const selections = { '["issuer","TEST","subject"]': 'org-1' };
    await saveOrganizationPreferences(path, selections);
    expect(await readOrganizationPreferences(path)).toEqual(selections);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, 'utf8')).toBe(JSON.stringify(selections));
    await Promise.all([saveOrganizationPreferences(path, { user: 'org-1' }), saveOrganizationPreferences(path, { user: 'org-2' })]);
    expect(['org-1', 'org-2']).toContain((await readOrganizationPreferences(path)).user);
    expect(await readdir(join(directory, 'nested'))).toEqual(['organizations.json']);
    for (const invalid of ['[]', '{"subject":1}', '{']) {
      await writeFile(path, invalid);
      await expect(readOrganizationPreferences(path)).rejects.toMatchObject({ code: 'organization_preference_invalid' });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
