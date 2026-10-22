/** Keep provider stderr private: it can include credentials or workload data. */
export function providerCliError(binary: 'aws' | 'gcloud', error: unknown, fallback: string): Error {
  const failure = error as { code?: unknown; stderr?: unknown } | null;
  if (failure?.code === 'ENOENT') return new Error(`${binary}_cli_required`);
  const stderr = typeof failure?.stderr === 'string' ? failure.stderr : '';
  if (binary === 'aws' && /Unable to locate credentials|ExpiredToken|InvalidClientTokenId|UnrecognizedClientException|security token included in the request is invalid|SSO session[^\n]*expired/i.test(stderr))
    return new Error('aws_authentication_required');
  if (binary === 'gcloud' && /You do not currently have an active account selected|Please run:\s*gcloud auth login|does not have any valid credentials|invalid_grant/i.test(stderr))
    return new Error('gcloud_authentication_required');
  return new Error(fallback);
}
