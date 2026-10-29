interface Organization { readonly id: string; readonly name: string }

export function organizationDisplayName(organization: Organization, organizations: readonly Organization[]): string {
  if (organizations.filter(({ name }) => name === organization.name).length < 2) return organization.name;
  const suffix = organization.id.slice(-8);
  const ambiguous = organizations.some(({ id, name }) => name === organization.name && id !== organization.id && id.endsWith(suffix));
  return `${organization.name} · ${ambiguous ? organization.id : suffix}`;
}
