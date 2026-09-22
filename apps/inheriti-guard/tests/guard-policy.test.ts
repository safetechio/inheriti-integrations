import { describe, expect, it } from 'vitest';
import { navigationDecision } from '../src/background/guard/url-policy.js';

describe('Guard navigation policy', () => {
  it.each([
    ['https://inheriti.com', 'allow-trusted'],
    ['https://business-stg.inheriti.com/path', 'allow-trusted'],
    ['https://kyc.cloudflareaccess.com/cdn-cgi/access/login', 'allow-trusted'],
    ['https://accounts.google.com/o/oauth2/auth', 'allow-trusted'],
    ['chrome://extensions', 'allow-internal'],
    ['about:blank', 'allow-internal'],
    ['https://notinheriti.com', 'deny'],
    ['https://inheriti.com.attacker.example', 'deny'],
    ['ftp://inheriti.com/file', 'deny'],
    ['javascript:alert(1)', 'deny'],
    ['not a url', 'deny'],
  ])('%s -> %s', (url, expected) => expect(navigationDecision(url)).toBe(expected));
});
