/** The SDK validates the ID token before the Tray reads its display claims. */
export function accountNameFromIdToken(idToken: string | undefined): string | undefined {
  const payload = idToken?.split('.')[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    const parts = [claims.given_name, claims.family_name].filter((part): part is string => typeof part === 'string' && !!part.trim());
    const name = [claims.name, parts.join(' '), claims.preferred_username]
      .find((value) => typeof value === 'string' && !!value.trim());
    return typeof name === 'string' ? name.trim().slice(0, 80) : undefined;
  } catch {
    return undefined;
  }
}
