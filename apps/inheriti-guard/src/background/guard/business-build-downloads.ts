const BUSINESS_BUILD_ENDPOINTS = [
  { environment: 'dev', site: 'business-dev.inheriti.com', storage: 'inheriti-business-media-dev.s3.amazonaws.com' },
  { environment: 'stg', site: 'business-stg.inheriti.com', storage: 'inheriti-business-media-stg.s3.amazonaws.com' },
  { environment: 'prod', site: 'business.inheriti.com', storage: 'inheriti-business-media-prod.s3.eu-west-1.amazonaws.com' },
];

const PUBLISHED_ID = '[0-9a-f-]+';
const SIGNED_QUERY = '\\?X-Amz-Algorithm=AWS4-HMAC-SHA256&[^#]*&X-Amz-Signature=[0-9a-f]+(?:&[^#]*)?$';

// Keep the pattern within Chrome's DNR limit. S3 validates the signature for the exact object key.
export const BUSINESS_BUILD_DOWNLOADS = BUSINESS_BUILD_ENDPOINTS.map(({ environment, site, storage }) => ({
  site,
  urlPattern: new RegExp(
    `^https://${storage.replaceAll('.', '\\.')}/integration-builds/${environment}/published/${PUBLISHED_ID}/${PUBLISHED_ID}/[a-zA-Z0-9._-]+${SIGNED_QUERY}`,
  ),
}));

export function isBusinessBuildDownload(url: string, referrer?: string): boolean {
  if (!referrer) return false;
  try {
    const origin = new URL(referrer).origin;
    return BUSINESS_BUILD_DOWNLOADS.some(({ site, urlPattern }) => origin === `https://${site}` && urlPattern.test(url));
  } catch {
    return false;
  }
}
