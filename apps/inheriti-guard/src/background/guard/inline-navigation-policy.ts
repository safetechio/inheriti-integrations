import { isEcosystemUrl } from './url-policy.js';

export interface InlineNavigationCandidate {
  enabled: boolean;
  frameId: number;
  destination: string;
  currentTabUrl?: string;
  openerTabUrl?: string;
}

export function isInlineDocumentUrl(value: string): boolean {
  return /^data:(text\/html|application\/xhtml\+xml|image\/svg\+xml)(?:[;,]|$)/iu.test(value)
    || value.toLowerCase().startsWith('blob:');
}

function blobEcosystemOrigin(value: string): boolean {
  if (!value.toLowerCase().startsWith('blob:')) return false;
  try { return isEcosystemUrl(new URL(value).pathname); } catch { return false; }
}

/** Browser-owned navigation inputs only; page messages cannot authorize this decision. */
export function shouldTrapInlineNavigation(candidate: InlineNavigationCandidate): boolean {
  if (!candidate.enabled || candidate.frameId !== 0 || !isInlineDocumentUrl(candidate.destination)) return false;
  return isEcosystemUrl(candidate.currentTabUrl)
    || isEcosystemUrl(candidate.openerTabUrl)
    || blobEcosystemOrigin(candidate.destination);
}
