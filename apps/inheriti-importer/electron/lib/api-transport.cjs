const { net, session } = require('electron');
const { randomBytes } = require('node:crypto');
const { activeContext } = require('./api-session.cjs');

// The Business API origin the renderer's transport is allowed to reach.
// Wired from the build env; empty in a bare dev run.
const API_ORIGIN = process.env.INHERITI_API_ORIGIN || '';

function resetCsrfToken(context = activeContext()) {
  if (context) context.csrfToken = null;
}

async function ensureCsrf(context = activeContext()) {
  if (!context || context.revoked) throw new Error('AUTH_SIGNED_OUT');
  if (context.csrfToken) return context.csrfToken;
  if (context.csrfInFlight) return context.csrfInFlight;
  const inFlight = apiFetch({ method: 'GET', path: '/csrf', skipCsrf: true, context })
    .then((res) => {
      context.csrfToken =
        (res.body && (res.body.result?.token || res.body.token || res.body.csrfToken)) || null;
      return context.csrfToken;
    })
    .finally(() => {
      if (context.csrfInFlight === inFlight) context.csrfInFlight = null;
    });
  context.csrfInFlight = inFlight;
  return inFlight;
}

async function authCookieNames(context = activeContext()) {
  if (!context) return [];
  return (await context.session.cookies.get({ url: API_ORIGIN }))
    .map((cookie) => cookie.name)
    .filter((name) =>
      ['token', 'refreshToken', 'safeIdToken', 'safeIdRefreshToken'].includes(name),
    );
}

async function persistResponseCookies(url, headers, context) {
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
      let clearCookie = false;
      for (const attribute of attributes) {
        const [rawName, ...rawValue] = attribute.trim().split('=');
        const attributeName = rawName.toLowerCase();
        const attributeValue = rawValue.join('=').trim();
        if (attributeName === 'path' && attributeValue) cookie.path = attributeValue;
        if (attributeName === 'httponly') cookie.httpOnly = true;
        if (attributeName === 'secure' && target.protocol === 'https:') cookie.secure = true;
        if (attributeName === 'max-age' && attributeValue) {
          const maxAge = Number(attributeValue);
          if (Number.isFinite(maxAge)) {
            clearCookie = maxAge <= 0;
            cookie.expirationDate = Math.floor(Date.now() / 1000) + maxAge;
          }
        }
        if (attributeName === 'expires' && attributeValue && cookie.expirationDate === undefined) {
          const expires = Date.parse(attributeValue);
          if (Number.isFinite(expires)) {
            cookie.expirationDate = Math.floor(expires / 1000);
            clearCookie = expires <= Date.now();
          }
        }
      }
      if (context.revoked) return;
      if (clearCookie) {
        await context.session.cookies.remove(
          new URL(cookie.path, target.origin).toString(),
          cookie.name,
        );
        return;
      }
      await context.session.cookies.set(cookie);
    }),
  );
}

// One place that talks to the Business API. Uses Electron `net` bound to the
// isolated session so the persisted cookies ride along automatically.
function apiFetch({
  method,
  path: apiPath,
  query,
  body,
  skipCsrf,
  authorization,
  context = activeContext(),
}) {
  return new Promise((resolve, reject) => {
    if (!API_ORIGIN || !context || context.revoked) {
      reject(new Error(!API_ORIGIN ? 'INHERITI_API_ORIGIN is not configured' : 'AUTH_SIGNED_OUT'));
      return;
    }

    const url = new URL(apiPath, API_ORIGIN);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    context.session.cookies
      .get({ url: url.toString() })
      .then((cookies) => {
        if (context.revoked) throw new Error('AUTH_CONTEXT_CHANGED');
        const req = net.request({ method, url: url.toString(), session: context.session });
        req.setHeader('Accept', 'application/json');
        const currentCookies = cookies.filter(
          (cookie) =>
            cookie.value &&
            (cookie.expirationDate === undefined || cookie.expirationDate > Date.now() / 1000),
        );
        if (currentCookies.length && !authorization)
          req.setHeader(
            'Cookie',
            currentCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
          );
        if (body !== undefined) req.setHeader('Content-Type', 'application/json');
        if (authorization) req.setHeader('Authorization', authorization);
        if (!skipCsrf && context.csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
          req.setHeader('x-csrf-token', context.csrfToken);
        }

        let raw = '';
        req.on('response', (response) => {
          response.on('data', (chunk) => {
            raw += chunk;
          });
          response.on('end', async () => {
            try {
              const setCookieHeaders =
                response.headers['set-cookie'] || response.headers['Set-Cookie'] || [];
              console.info(
                '[api] response:',
                response.statusCode,
                new URL(url).pathname,
                'set-cookie headers:',
                Array.isArray(setCookieHeaders)
                  ? setCookieHeaders.length
                  : setCookieHeaders
                    ? 1
                    : 0,
              );
              await persistResponseCookies(url.toString(), response.headers, context);
              let parsed = null;
              try {
                parsed = raw ? JSON.parse(raw) : null;
              } catch {
                parsed = raw;
              }
              if (context.revoked) throw new Error('AUTH_CONTEXT_CHANGED');
              resolve({ status: response.statusCode, body: parsed, headers: response.headers });
            } catch (error) {
              reject(error);
            }
          });
        });
        req.on('error', reject);
        if (body !== undefined) req.write(JSON.stringify(body));
        req.end();
      })
      .catch(reject);
  });
}

async function revokeSession(context) {
  if (!context) return false;
  let timer;
  const isolated = {
    session: session.fromPartition(`inheriti-family-revoke-${randomBytes(16).toString('hex')}`),
    csrfToken: null,
    csrfInFlight: null,
    revoked: false,
  };
  try {
    const cookies = await context.session.cookies.get({ url: API_ORIGIN });
    const refresh = cookies.find((cookie) => cookie.name === 'refreshToken');
    if (!refresh) return false;
    await isolated.session.cookies.set({
      url: API_ORIGIN,
      name: 'refreshToken',
      value: refresh.value,
      path: refresh.path || '/',
      secure: !!refresh.secure,
      httpOnly: !!refresh.httpOnly,
    });
    const attempt = (async () => {
      await ensureCsrf(isolated);
      const result = await apiFetch({ method: 'POST', path: '/user/logout', context: isolated });
      return result.status >= 200 && result.status < 300;
    })();
    const success = await Promise.race([
      attempt,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), 3000);
      }),
    ]);
    return !success;
  } catch (error) {
    console.warn('[auth] family revocation failed:', error?.message || 'unknown error');
    return true;
  } finally {
    clearTimeout(timer);
    isolated.revoked = true;
    try {
      await isolated.session.clearStorageData({ storages: ['cookies'] });
    } catch (error) {
      console.warn(
        '[auth] temporary revocation cookies could not be cleared:',
        error?.message || 'unknown error',
      );
    }
  }
}

module.exports = {
  API_ORIGIN,
  apiFetch,
  ensureCsrf,
  resetCsrfToken,
  authCookieNames,
  revokeSession,
};
