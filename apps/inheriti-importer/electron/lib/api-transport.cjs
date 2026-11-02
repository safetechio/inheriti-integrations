const { net } = require('electron');

const API_ORIGIN = process.env.INHERITI_API_ORIGIN || '';
const REQUEST_TIMEOUT_MS = 30_000;

function bearerApiFetch({ method, path, query, body, token, environment, organizationId, relay = false }) {
  return new Promise((resolve, reject) => {
    if (!API_ORIGIN) return reject(new Error('INHERITI_API_ORIGIN is not configured'));
    if (!token) return reject(new Error('AUTH_SIGNED_OUT'));
    const url = new URL(path, API_ORIGIN);
    const allowedPath = relay
      ? /^\/integrations\/v1\/organizations\/[^/]+\/master-key-relay$/.test(url.pathname)
      : url.pathname.startsWith('/integrations/v1/');
    if (url.origin !== new URL(API_ORIGIN).origin || !allowedPath) {
      return reject(new Error('Unsupported Business API path'));
    }
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const request = net.request({ method, url: url.toString() });
    request.setHeader('Accept', 'application/json');
    request.setHeader('Authorization', `Bearer ${token}`);
    if (!relay) request.setHeader('x-elements-environment', environment);
    if (!relay && organizationId) request.setHeader('x-organization-id', organizationId);
    if (body !== undefined) request.setHeader('Content-Type', 'application/json');
    let raw = '';
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result);
    };
    const timeout = setTimeout(() => {
      finish(new Error('Business API request timed out'));
      request.abort();
    }, REQUEST_TIMEOUT_MS);
    request.on('response', (response) => {
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; }
        catch { parsed = raw; }
        finish(null, { status: response.statusCode, body: parsed, headers: response.headers });
      });
      response.on('error', (error) => finish(error));
      response.on('aborted', () => finish(new Error('Business API response aborted')));
      response.on('close', () => finish(new Error('Business API response closed before completion')));
    });
    request.on('error', (error) => finish(error));
    request.on('abort', () => finish(new Error('Business API request aborted')));
    try {
      if (body !== undefined) request.write(JSON.stringify(body));
      request.end();
    } catch (error) {
      finish(error);
      request.abort();
    }
  });
}

function relayApiFetch({ path, body, token }) {
  return bearerApiFetch({ method: 'POST', path, body, token, relay: true });
}

module.exports = { bearerApiFetch, relayApiFetch };
