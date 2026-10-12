# Sample import fixtures

Synthetic, fake-credential files for manually exercising each supported import
source from the app's "Choose files" screen. No real secrets.

| File | Source type | Notes |
|---|---|---|
| `keepass-demo-vault.kdbx` | KeePass | Password: `demo-password`. 2 groups, 4 entries. Regenerate with `node scripts/generate-fixture-kdbx.mjs`. |
| `passbolt-export.json` | Passbolt-compatible JSON | Cleartext/legacy resource array with folders and tags. This is parser-compatible test data, not a native encrypted Passbolt v5 export. |
| `passbolt-export.csv` | Passbolt-compatible CSV | Cleartext, header-based rows. |
| `k8s-secrets.yaml` | Kubernetes | Multi-document Opaque, registry, `stringData`, TLS, and ConfigMap resources. |
| `k8s-secrets.json` | Kubernetes | JSON `List` with a `kubernetes.io/basic-auth` Secret and ConfigMap. |
| `vault-kv-dump.json` | HashiCorp Vault | KV v2 `vault kv get -format=json` shape. |
| `vault-kv-v1.yaml` | HashiCorp Vault | KV v1 response in YAML. |
| `sample.env` | dotenv | Mixed quoted/unquoted/`export` lines. |
| `.env.production` | dotenv | Environment-suffixed dotenv file. |
| `aws-secretsmanager.json` | Cloud (AWS) | Batch `SecretValues` with JSON/plain `SecretString` and `SecretBinary`. |
| `azure-keyvault-secret.json` | Cloud (Azure) | `az keyvault secret show` shape with content type and tags. |
| `gcp-secretmanager.json` | Cloud (GCP) | Version access shape with a base64-encoded JSON payload. |

All values are fabricated for testing only.
