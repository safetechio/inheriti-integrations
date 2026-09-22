export const TRUSTED_HOSTS = [
  'inheriti.com',
  'safetech.io',
  'safekey.be',
  'cloudflareaccess.com',
  'cloudflare.com',
  'youtube.com',
  'accounts.google.com',
  'appleid.apple.com',
  'facebook.com',
  'twitter.com',
  'x.com',
] as const;

const INTERNAL_SCHEMES = [
  'chrome:', 'chrome-extension:', 'chrome-error:', 'chrome-search:', 'chrome-untrusted:',
  'devtools:', 'edge:', 'about:', 'view-source:',
] as const;

export function isBrowserInternalUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') return true;
  const normalized = value.trim().toLowerCase();
  return INTERNAL_SCHEMES.some((scheme) => normalized.startsWith(scheme));
}

export function isTrustedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return TRUSTED_HOSTS.some((trusted) => normalized === trusted || normalized.endsWith(`.${trusted}`));
}

export function isTrustedUrl(value: unknown): boolean {
  if (isBrowserInternalUrl(value)) return true;
  try {
    const parsed = new URL(String(value));
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && isTrustedHostname(parsed.hostname);
  } catch {
    return false;
  }
}

export function isEcosystemUrl(value: unknown): boolean {
  try {
    const parsed = new URL(String(value));
    return ['inheriti.com', 'safetech.io', 'safekey.be']
      .some((root) => parsed.hostname === root || parsed.hostname.endsWith(`.${root}`));
  } catch {
    return false;
  }
}

export type NavigationDecision = 'allow-internal' | 'allow-trusted' | 'deny';

export function navigationDecision(value: unknown): NavigationDecision {
  if (isBrowserInternalUrl(value)) return 'allow-internal';
  return isTrustedUrl(value) ? 'allow-trusted' : 'deny';
}
