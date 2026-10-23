/** Preserve provider diagnostics for the invoking CLI; do not serialize them through API or MCP results. */
export function providerCliError(binary: 'aws' | 'gcloud', error: unknown, fallback: string): Error {
  const failure = error as { code?: unknown; stderr?: unknown } | null;
  const stderr = typeof failure?.stderr === 'string' ? failure.stderr : '';
  const diagnostic = stderr.trim() || (typeof failure?.code === 'number' ? `Exit code ${failure.code}`
    : typeof failure?.code === 'string' && /^[A-Z][A-Z0-9_]+$/u.test(failure.code) ? `Process error ${failure.code}` : undefined);
  const result = (code: string) => {
    const result = new Error(code);
    if (diagnostic) Object.defineProperty(result, 'providerDiagnostic', {
      value: `${binary === 'aws' ? 'AWS' : 'gcloud'} CLI: ${diagnostic.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/gu, '')}`,
    });
    return result;
  };
  if (failure?.code === 'ENOENT') return result(`${binary}_cli_required`);
  if (binary === 'aws' && /Unable to locate credentials|ExpiredToken|InvalidClientTokenId|UnrecognizedClientException|security token included in the request is invalid|SSO session[^\n]*expired/i.test(stderr))
    return result('aws_authentication_required');
  if (binary === 'gcloud' && /You do not currently have an active account selected|Please run:\s*gcloud auth login|does not have any valid credentials|invalid_grant/i.test(stderr))
    return result('gcloud_authentication_required');
  return result(fallback);
}
