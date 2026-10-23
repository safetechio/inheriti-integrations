import { describe, expect, it } from 'vitest';
import { providerCliError } from '../src/provider-cli-error.js';

describe('provider CLI diagnostics', () => {
  it.each(['aws', 'gcloud'] as const)('reports missing %s', binary => {
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

  it('preserves the complete AWS CLI error for the invoking terminal only', () => {
    const stderr = 'An error occurred (AccessDeniedException) when calling the DescribeTaskDefinition operation: not authorized to perform: ecs:DescribeTaskDefinition on arn:aws:ecs:us-east-1:123456789012:service/example';
    const error = providerCliError('aws', { stderr }, 'automation_cloud_inspection_failed');
    expect(error).toMatchObject({ message: 'automation_cloud_inspection_failed',
      providerDiagnostic: `AWS CLI: ${stderr}` });
    expect(JSON.stringify(error)).toBe('{}');
  });

  it('preserves an unrecognized, multiline gcloud CLI error', () => {
    const stderr = 'ERROR: (gcloud.run.services.describe) PERMISSION_DENIED: Permission denied\nRun gcloud auth login, then retry.';
    const error = providerCliError('gcloud', { stderr }, 'automation_cloud_inspection_failed');
    expect(error).toMatchObject({ message: 'automation_cloud_inspection_failed',
      providerDiagnostic: `gcloud CLI: ${stderr}` });
    expect(JSON.stringify(error)).toBe('{}');
  });

  it('shows a provider exit code when stderr is empty', () => {
    expect(providerCliError('aws', { code: 255 }, 'automation_cloud_inspection_failed'))
      .toMatchObject({ providerDiagnostic: 'AWS CLI: Exit code 255' });
    expect(providerCliError('gcloud', { code: 'ETIMEDOUT' }, 'automation_cloud_inspection_failed'))
      .toMatchObject({ providerDiagnostic: 'gcloud CLI: Process error ETIMEDOUT' });
  });
});
