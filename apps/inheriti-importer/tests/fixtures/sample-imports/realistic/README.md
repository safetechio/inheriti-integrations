# Realistic synthetic importer fixtures

Northline Logistics, its vaults, teams, credentials, endpoints and notes are fictional. These fixtures were authored for repeatable importer tests using documented format structures. They contain no live credentials or copied customer records. Service URLs use the reserved `example.invalid` domain. The TLS and private material fields contain conspicuous text markers. The PDF-named attachment contains only an inert PDF signature and comment.

| Fixture | Source records | Expected imported entries |
| --- | ---: | ---: |
| `onepassword-rich.1pux` | 42 across 3 vaults | 41 |
| `onepassword-bulk.1pux` | 1,050 across 7 vaults | 1,050 |
| `passbolt-export.csv` | 36 | 36 |
| `passbolt-compatible.json` | 36 | 36 |
| `kubernetes-multidoc.yaml` and `kubernetes-list.json` | 37 each | 36 each |
| `vault-kv-v1.yaml` and `vault-kv-v2.json` | 30 each | 30 each |
| `aws-secretsmanager.json`, `azure-keyvault.json`, and `gcp-secretmanager.json` | 27 each | 27 each |
| `services.env` | 42 assignments | 41 |

Open `onepassword-rich.export-data.json` to inspect or edit the readable JSON copied byte-for-byte into `export.data`. Change the generator to persist customizations in future runs. The rich ZIP includes duplicate section fields and website labels, card and PIN values with leading zeros, notes-only and archived items, whitespace-sensitive credentials, Unicode, mixed line endings, typed fields, nested arrays and unknown properties. The expected omissions are the file-only item, the attachment bytes of the mixed item, and password history. Kubernetes ignores a Namespace, and dotenv omits the explicit empty assignment.

The Passbolt CSV uses an importer-compatible CSV header with a UTF-8 BOM, quoted fields and CRLF. The JSON is an importer-compatible resource wrapper containing simulated decrypted fields. Passbolt documents CSV and KDBX browser exports. Vault and cloud collections bundle repeated individual response shapes for import testing. The Azure ID intentionally carries the usual Key Vault host markers inside a reserved domain.

Use the files under `unsupported/` for a valid ZIP with a future 1PUX format version, a one-cell Excel workbook, and a regular ZIP with a text document. Use `malformed/` for a deliberately truncated 1PUX. Keep those files out of successful-import batches.

Run from `apps/inheriti-importer`:

```bash
node scripts/generate-realistic-import-fixtures.mjs
node scripts/generate-realistic-import-fixtures.mjs --check
pnpm exec vitest run tests/modules/import/infrastructure/parsers/realistic-fixtures.test.ts
```

`manifest.json` records source and expected entry counts, archive versions, omissions, source byte sizes and SHA-256 digests. The rich archive also has a set of expected normalized field digests. Checks can use the title and field label to compare decoded values without printing them.

## Format references

- [1Password 1PUX structure](https://support.1password.com/1pux-format/) and [export options](https://support.1password.com/export/)
- [Passbolt browser exports](https://www.passbolt.com/docs/user/basic-features/browser/export/)
- [Kubernetes Secrets](https://kubernetes.io/docs/concepts/configuration/secret/) and [ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/)
- [Vault KV v1](https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v1) and [KV v2](https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2)
- [AWS GetSecretValue](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html), [Azure Get Secret](https://learn.microsoft.com/en-us/rest/api/keyvault/secrets/get-secret/get-secret), and [GCP Secret Manager access](https://cloud.google.com/secret-manager/docs/reference/rest/v1/projects.secrets.versions/access)
