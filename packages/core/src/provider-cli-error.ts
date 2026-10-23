/** Mutation stderr may echo workload secrets; only read-only callers can show it verbatim. */
export function providerCliError(binary: 'aws' | 'gcloud', error: unknown, fallback: string, showStderr = false): Error {
  const failure = error as { code?: unknown; stderr?: unknown } | null;
  const stderr = typeof failure?.stderr === 'string' ? failure.stderr : '';
  const aws = binary === 'aws' && stderr.match(/An error occurred \(([A-Za-z][A-Za-z0-9]{0,63})\) when calling the ([A-Za-z][A-Za-z0-9]{0,63}) operation:/u);
  const gcloud = binary === 'gcloud' && stderr.match(/ERROR: \((gcloud[.a-z0-9_-]{1,100})\) ([A-Z][A-Z0-9_]{1,63}):/u);
  const diagnostic = showStderr && stderr.trim() ? stderr.trim().replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/gu, '')
    : aws ? `${aws[1]} in ${aws[2]}` : gcloud ? `${gcloud[2]} in ${gcloud[1]}`
    : (typeof failure?.code === 'number' ? `Exit code ${failure.code}`
    : typeof failure?.code === 'string' && /^[A-Z][A-Z0-9_]+$/u.test(failure.code) ? `Process error ${failure.code}` : undefined);
  const result = (code: string) => {
    const result = new Error(code);
    if (diagnostic) Object.defineProperty(result, 'providerDiagnostic', {
      value: `${binary === 'aws' ? 'AWS' : 'gcloud'} CLI: ${diagnostic}`,
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
