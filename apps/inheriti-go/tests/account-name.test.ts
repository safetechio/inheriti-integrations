import { expect, it } from 'vitest';
import { accountNameFromIdToken } from '../src/modules/auth/main/account-name.js';

it('reads a name from the validated ID token and ignores malformed claims', () => {
  const token = (claims: unknown) => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
  expect(accountNameFromIdToken(token({ name: '  Eduardo C.  ' }))).toBe('Eduardo C.');
  expect(accountNameFromIdToken(token({ given_name: 'E2E', family_name: 'Owner' }))).toBe('E2E Owner');
  expect(accountNameFromIdToken('bad-token')).toBeUndefined();
});
