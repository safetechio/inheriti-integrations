import { isEcosystemUrl } from './url-policy.js';

const RISKY_EXTENSIONS = new Set([
  'html', 'htm', 'xhtml', 'svg', 'js', 'jse', 'exe', 'msi', 'dll', 'bat', 'cmd', 'com', 'scr',
  'pif', 'wsf', 'vbs', 'hta', 'ps1', 'apk',
]);

export interface DownloadCandidate {
  url?: string;
  finalUrl?: string;
  referrer?: string;
  filename?: string;
}

function extension(value: string): string {
  try {
    const parsed = new URL(value);
    value = parsed.pathname;
  } catch {
    value = value.split(/[?#]/, 1)[0] ?? '';
  }
  const match = /\.([a-z0-9]+)$/i.exec(value);
  return match?.[1]?.toLowerCase() ?? '';
}

export function shouldBlockDownload(candidate: DownloadCandidate, enabled = true): boolean {
  if (!enabled) return false;
  const url = candidate.finalUrl || candidate.url || '';
  const fromEcosystem = isEcosystemUrl(url) || isEcosystemUrl(candidate.referrer);
  const lowered = url.toLowerCase();
  const inlineRisk = lowered.startsWith('blob:')
    || /^data:(text\/html|application\/xhtml\+xml|image\/svg\+xml)/i.test(lowered);
  if (inlineRisk) return fromEcosystem || lowered.includes('inheriti.com');
  if (!fromEcosystem) return false;
  return RISKY_EXTENSIONS.has(extension(candidate.filename || url));
}
