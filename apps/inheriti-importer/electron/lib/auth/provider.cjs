const crypto = require('node:crypto');
const { net } = require('electron');

const SAFEID_URL = process.env.SAFEID_URL || '';
const SAFEID_REALM = process.env.SAFEID_REALM || '';
const SAFEID_CLIENT_ID = process.env.SAFEID_CLIENT_ID || '';

function randomBase64Url(size = 32) {
  return crypto.randomBytes(size).toString('base64url');
}

function sha256Base64Url(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function decodeJwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: options.method || 'GET', url });
    if (options.headers)
      Object.entries(options.headers).forEach(([name, value]) => req.setHeader(name, value));
    let raw = '';
    req.on('response', (response) => {
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => {
        let body = null;
        try {
          body = raw ? JSON.parse(raw) : null;
        } catch {
          body = raw;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`AUTH_PROVIDER_${response.statusCode}`));
          return;
        }
        resolve(body);
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

module.exports = {
  SAFEID_URL,
  SAFEID_REALM,
  SAFEID_CLIENT_ID,
  randomBase64Url,
  sha256Base64Url,
  decodeJwtPayload,
  requestJson,
};
