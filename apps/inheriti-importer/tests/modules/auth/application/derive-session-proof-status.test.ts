import { describe, expect, it } from 'vitest';
import { deriveSessionProofStatus } from '@modules/auth/application/derive-session-proof-status';

describe('deriveSessionProofStatus', () => {
  it('is ready once the cookie session is AUTHENTICATED', () => {
    expect(
      deriveSessionProofStatus({
        cookieStatus: 'AUTHENTICATED',
        previousCookieStatus: 'CONFIRMING',
        isOnline: true,
      }),
    ).toBe('ready');
  });

  it('is checking while CONFIRMING', () => {
    expect(
      deriveSessionProofStatus({
        cookieStatus: 'CONFIRMING',
        previousCookieStatus: 'IDLE',
        isOnline: true,
      }),
    ).toBe('checking');
  });

  it('is checking on a first-mount IDLE (no previous status yet)', () => {
    expect(
      deriveSessionProofStatus({
        cookieStatus: 'IDLE',
        previousCookieStatus: null,
        isOnline: true,
      }),
    ).toBe('checking');
  });

  it('is expired when the manager reports EXPIRED', () => {
    expect(
      deriveSessionProofStatus({
        cookieStatus: 'EXPIRED',
        previousCookieStatus: 'AUTHENTICATED',
        isOnline: true,
      }),
    ).toBe('expired');
  });

  it('is replaced when AUTHENTICATED drops to IDLE without a local logout', () => {
    expect(
      deriveSessionProofStatus({
        cookieStatus: 'IDLE',
        previousCookieStatus: 'AUTHENTICATED',
        isOnline: true,
      }),
    ).toBe('replaced');
  });

  it('is replaced when a re-confirmation (CONFIRMING) drops to IDLE', () => {
    expect(
      deriveSessionProofStatus({
        cookieStatus: 'IDLE',
        previousCookieStatus: 'CONFIRMING',
        isOnline: true,
      }),
    ).toBe('replaced');
  });

  it('is offline when ERROR and the browser reports no connectivity', () => {
    expect(
      deriveSessionProofStatus({
        cookieStatus: 'ERROR',
        previousCookieStatus: 'CONFIRMING',
        isOnline: false,
      }),
    ).toBe('offline');
  });

  it('is error when ERROR and the browser reports connectivity', () => {
    expect(
      deriveSessionProofStatus({
        cookieStatus: 'ERROR',
        previousCookieStatus: 'CONFIRMING',
        isOnline: true,
      }),
    ).toBe('error');
  });
});
