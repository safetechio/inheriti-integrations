const CATALOG_ORIGIN = 'http://127.0.0.1:6110';
const CATALOG_HMR_ORIGIN = 'ws://127.0.0.1:6111';

function isCatalogUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.origin === CATALOG_ORIGIN;
  } catch {
    return false;
  }
}

function isCatalogRequest(value) {
  if (isCatalogUrl(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'ws:' && url.origin === CATALOG_HMR_ORIGIN;
  } catch {
    return false;
  }
}

function catalogContentSecurityPolicy() {
  return [
    "default-src 'self'",
    // Ladle's development runtime evaluates story code; this isolated window has no app bridge.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' ws://127.0.0.1:6111",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

module.exports = { CATALOG_ORIGIN, isCatalogUrl, isCatalogRequest, catalogContentSecurityPolicy };
