import { describe, expect, it } from 'vitest';
import { redact } from '../src/output.js';

const JWT = 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImFiY2RlZmdo.eyJzdWIiOiJvcGVyYXRvci0xIiwiZXhwIjo5OTk5.c2lnbmF0dXJl';

describe('output redaction', () => {
  it('replaces a JWT-shaped value wherever it appears', () => {
    expect(redact({ nested: { token: JWT } })).toEqual({ nested: { token: '<redacted>' } });
    expect(redact([JWT])).toEqual(['<redacted>']);
  });

  it('replaces known credential keys even when the value looks harmless', () => {
    expect(redact({ refreshToken: 'short', userCode: 'WDJB-MJHT', deviceCode: 'abc' }))
      .toEqual({ refreshToken: '<redacted>', userCode: '<redacted>', deviceCode: '<redacted>' });
  });

  it('leaves ordinary plan fields untouched', () => {
    const plan = { id: 'plan-1', name: 'Family vault', status: 'ACTIVE', assets: { count: 2, types: ['DOCUMENT'] } };
    expect(redact(plan)).toEqual(plan);
  });
});
