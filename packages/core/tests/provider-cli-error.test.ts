import { describe, expect, it } from 'vitest';
import { providerCliError } from '../src/provider-cli-error.js';

describe('provider CLI diagnostics', () => {
  it.each(['aws', 'gcloud'] as const)('reports missing %s without exposing stderr', binary => {
    expect(providerCliError(binary, { code: 'ENOENT', stderr: 'secret' }, 'fallback').message)
      .toBe(`${binary}_cli_required`);
  });

  it('recognizes missing AWS credentials', () => {
    expect(providerCliError('aws', { stderr: 'Unable to locate credentials. secret' }, 'fallback').message)
      .toBe('aws_authentication_required');
  });

  it('recognizes inactive gcloud authentication', () => {
    expect(providerCliError('gcloud', { stderr: 'You do not currently have an active account selected. secret' }, 'fallback').message)
      .toBe('gcloud_authentication_required');
  });

  it.each(['AccessDeniedException', 'PERMISSION_DENIED', 'resource not found'])('keeps %s as provider error', stderr => {
    expect(providerCliError('aws', { stderr }, 'fallback').message).toBe('fallback');
    expect(providerCliError('gcloud', { stderr }, 'fallback').message).toBe('fallback');
  });
});
