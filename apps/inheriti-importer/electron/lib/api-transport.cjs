const { net } = require('electron');
const { apiSession } = require('./api-session.cjs');

// The Business API origin the renderer's transport is allowed to reach.
// Wired from the build env; empty in a bare dev run.
const API_ORIGIN = process.env.INHERITI_API_ORIGIN || '';

let csrfToken = null;
let csrfInFlight = null;

function resetCsrfToken() {
  csrfToken = null;
}

async function ensureCsrf() {
  if (csrfToken) return csrfToken;
  if (csrfInFlight) return csrfInFlight;
  csrfInFlight = apiFetch({ method: 'GET', path: '/csrf', skipCsrf: true })
    .then((res) => {
      csrfToken =
        (res.body && (res.body.result?.token || res.body.token || res.body.csrfToken)) || null;
      return csrfToken;
    })
    .finally(() => {
      csrfInFlight = null;
    });
  return csrfInFlight;
}

async function authCookieNames() {
  return (await apiSession().cookies.get({ url: API_ORIGIN }))
    .map((cookie) => cookie.name)
    .filter((name) =>
      ['token', 'refreshToken', 'safeIdToken', 'safeIdRefreshToken'].includes(name),
    );
}

async function persistResponseCookies(url, headers) {
  const setCookies = headers['set-cookie'] || headers['Set-Cookie'];
  if (!setCookies) return;
  const target = new URL(url);
  const values = Array.isArray(setCookies) ? setCookies : [setCookies];

  await Promise.all(
    values.map(async (header) => {
      const [nameValue, ...attributes] = String(header).split(';');
      const separator = nameValue.indexOf('=');
      if (separator <= 0) return;
      const cookie = {
        url: target.origin,
        name: nameValue.slice(0, separator).trim(),
        value: nameValue.slice(separator + 1).trim(),
        path: '/',
        secure: target.protocol === 'https:',
        httpOnly: false,
      };
      for (const attribute of attributes) {
        const [rawName, ...rawValue] = attribute.trim().split('=');
        const attributeName = rawName.toLowerCase();
        const attributeValue = rawValue.join('=').trim();
        if (attributeName === 'path' && attributeValue) cookie.path = attributeValue;
        if (attributeName === 'httponly') cookie.httpOnly = true;
        if (attributeName === 'secure' && target.protocol === 'https:') cookie.secure = true;
        if (attributeName === 'max-age' && attributeValue) {
          cookie.expirationDate = Math.floor(Date.now() / 1000) + Number(attributeValue);
        }
      }
      await apiSession().cookies.set(cookie);
    }),
  );
}

// One place that talks to the Business API. Uses Electron `net` bound to the
// isolated session so the persisted cookies ride along automatically.
function apiFetch({ method, path: apiPath, query, body, skipCsrf, authorization }) {
  return new Promise((resolve, reject) => {
    if (!API_ORIGIN) {
      reject(new Error('INHERITI_API_ORIGIN is not configured'));
      return;
    }

    const url = new URL(apiPath, API_ORIGIN);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    apiSession()
      .cookies.get({ url: url.toString() })
      .then((cookies) => {
        const req = net.request({ method, url: url.toString(), session: apiSession() });
        req.setHeader('Accept', 'application/json');
        if (cookies.length && !authorization)
          req.setHeader(
            'Cookie',
            cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
          );
        if (body !== undefined) req.setHeader('Content-Type', 'application/json');
        if (authorization) req.setHeader('Authorization', authorization);
        if (!skipCsrf && csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
          req.setHeader('x-csrf-token', csrfToken);
        }

        let raw = '';
        req.on('response', (response) => {
          response.on('data', (chunk) => {
            raw += chunk;
          });
          response.on('end', async () => {
            const setCookieHeaders =
              response.headers['set-cookie'] || response.headers['Set-Cookie'] || [];
            console.info(
              '[api] response:',
              response.statusCode,
              new URL(url).pathname,
              'set-cookie headers:',
              Array.isArray(setCookieHeaders) ? setCookieHeaders.length : setCookieHeaders ? 1 : 0,
            );
            await persistResponseCookies(url.toString(), response.headers);
            let parsed = null;
            try {
              parsed = raw ? JSON.parse(raw) : null;
            } catch {
              parsed = raw;
            }
            resolve({ status: response.statusCode, body: parsed, headers: response.headers });
          });
        });
        req.on('error', reject);
        if (body !== undefined) req.write(JSON.stringify(body));
        req.end();
      })
      .catch(reject);
  });
}

module.exports = {
  API_ORIGIN,
  apiFetch,
  ensureCsrf,
  resetCsrfToken,
  authCookieNames,
};
