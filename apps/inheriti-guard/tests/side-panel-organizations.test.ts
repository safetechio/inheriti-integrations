import { describe, expect, it } from 'vitest';
import { organizationDisplayName } from '../src/side-panel/main/organizations.js';

describe('SafeID organization picker labels', () => {
  it('distinguishes same-name organizations without changing their IDs', () => {
    const organizations = [
      { id: 'org-a-12345678', name: 'Shared Company' },
      { id: 'org-b-87654321', name: 'Shared Company' },
      { id: 'org-c', name: 'Unique Company' },
    ];
    expect(organizations.map((organization) => organizationDisplayName(organization, organizations))).toEqual([
      'Shared Company · 12345678', 'Shared Company · 87654321', 'Unique Company',
    ]);
    expect(organizations.map(({ id }) => id)).toEqual(['org-a-12345678', 'org-b-87654321', 'org-c']);
  });

  it('uses full IDs when duplicate suffixes would still look identical', () => {
    const organizations = [
      { id: 'org-a-12345678', name: 'Shared Company' },
      { id: 'org-b-12345678', name: 'Shared Company' },
    ];
    expect(organizations.map((organization) => organizationDisplayName(organization, organizations))).toEqual([
      'Shared Company · org-a-12345678', 'Shared Company · org-b-12345678',
    ]);
  });
});
