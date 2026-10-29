type NamedOrganization = { id: string; name: string };

export function organizationDisplayName(
  organization: NamedOrganization,
  organizations: NamedOrganization[],
) {
  const matching = organizations.filter((item) => item.name === organization.name);
  if (matching.length < 2) return organization.name;
  const suffix = organization.id.slice(-8);
  const uniqueSuffix = matching.filter((item) => item.id.slice(-8) === suffix).length === 1;
  return `${organization.name} (${uniqueSuffix ? suffix : organization.id})`;
}
