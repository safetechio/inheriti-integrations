import { describe, expect, it } from 'vitest';
import { waitForCallback } from '../src/modules/auth/main/oauth-callback.js';

describe('OAuth browser callback', () => {
  it.each([
    { query: 'code=private-code&state=private-state', status: 200, heading: 'Continue in Inheriti® Tray', rejection: null },
    { query: 'error=access_denied&error_description=private-description', status: 400, heading: 'Sign-in failed', rejection: 'access_denied' },
    { query: 'code=private-code', status: 400, heading: 'Sign-in failed', rejection: 'Invalid sign-in callback' },
  ])('renders a self-contained UTF-8 page for $query', async ({ query, status, heading, rejection }) => {
    let request: Promise<Response> | undefined;
    const outcome = await waitForCallback('https://example.com/authorize', async () => {
      request = fetch(`http://127.0.0.1:53682/oauth/callback?${query}`, { headers: { connection: 'close' } });
      await request;
    }, new AbortController().signal).then((url) => ({ url, error: null }), (error: Error) => ({ url: null, error }));
    const response = await request!;
    expect(response.status).toBe(status);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const html = await response.text();
    expect(html).toContain(`<h1 class="${status === 200 ? '' : 'failed'}">${heading}</h1>`);
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('data:font/ttf;base64,');
    expect(html).toContain('Inheriti® Tray');
    expect(html).not.toMatch(/private-|\{\{|Ã|Â|Business/);
    if (rejection) {
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.error?.message).toBe(rejection);
      expect(outcome.url).toBeNull();
    } else {
      expect(outcome.url).toBe(`http://127.0.0.1:53682/oauth/callback?${query}`);
    }
  });
});
