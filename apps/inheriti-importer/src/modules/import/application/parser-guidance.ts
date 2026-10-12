export function parserGuidance(message: string): string | null {
  if (/Passbolt.*(?:no secret|omitted password)/i.test(message))
    return 'Export passwords as JSON or CSV with secrets included, then retry this source.';
  if (/Kubernetes.*(?:no .*Secret|ConfigMap)/i.test(message))
    return 'Export value-bearing resources with kubectl get secret -o yaml (or json), then retry.';
  if (/Vault secrets were found/i.test(message))
    return 'Export with vault kv get -format=json, or provide a JSON dump of KV pairs.';
  if (/cloud secrets were found/i.test(message))
    return 'Export a value-bearing get-secret-value or secret show JSON response, not a list response.';
  return null;
}
