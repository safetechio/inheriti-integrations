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

  it('keeps only the AWS code and operation when stderr echoes a secret', () => {
    const stderr = 'An error occurred (AccessDeniedException) when calling the DescribeTaskDefinition operation: rejected environment value sentinel-secret';
    const error = providerCliError('aws', { stderr }, 'automation_cloud_inspection_failed');
    expect(error).toMatchObject({ message: 'automation_cloud_inspection_failed',
      providerDiagnostic: 'AWS CLI: AccessDeniedException in DescribeTaskDefinition' });
    expect((error as Error & { providerDiagnostic: string }).providerDiagnostic).not.toContain('sentinel-secret');
    expect(JSON.stringify(error)).toBe('{}');
  });

  it('shows complete AWS and gcloud errors for read-only provider calls', () => {
    const aws = 'An error occurred (AccessDeniedException) when calling the DescribeTaskDefinition operation: not authorized to perform: ecs:DescribeTaskDefinition';
    const gcloud = 'ERROR: (gcloud.run.services.describe) PERMISSION_DENIED: Permission denied';
    expect(providerCliError('aws', { stderr: aws }, 'fallback', true))
      .toMatchObject({ providerDiagnostic: `AWS CLI: ${aws}` });
    expect(providerCliError('gcloud', { stderr: gcloud }, 'fallback', true))
      .toMatchObject({ providerDiagnostic: `gcloud CLI: ${gcloud}` });
  });

  it('keeps only the gcloud code and operation when stderr echoes a secret', () => {
    const stderr = 'ERROR: (gcloud.run.services.describe) PERMISSION_DENIED: rejected sentinel-secret\nRun gcloud auth login, then retry.';
    const error = providerCliError('gcloud', { stderr }, 'automation_cloud_inspection_failed');
    expect(error).toMatchObject({ message: 'automation_cloud_inspection_failed',
      providerDiagnostic: 'gcloud CLI: PERMISSION_DENIED in gcloud.run.services.describe' });
    expect((error as Error & { providerDiagnostic: string }).providerDiagnostic).not.toContain('sentinel-secret');
    expect(JSON.stringify(error)).toBe('{}');
  });

  it('discards unstructured provider stderr', () => {
    expect(providerCliError('aws', { stderr: 'Validation failed: sentinel-secret' }, 'fallback'))
      .not.toHaveProperty('providerDiagnostic');
  });

  it('shows a provider exit code when stderr is empty', () => {
    expect(providerCliError('aws', { code: 255 }, 'automation_cloud_inspection_failed'))
      .toMatchObject({ providerDiagnostic: 'AWS CLI: Exit code 255' });
    expect(providerCliError('gcloud', { code: 'ETIMEDOUT' }, 'automation_cloud_inspection_failed'))
      .toMatchObject({ providerDiagnostic: 'gcloud CLI: Process error ETIMEDOUT' });
  });
});
