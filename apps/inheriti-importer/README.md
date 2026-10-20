# Inheriti® Importer

Desktop app for reviewing external secrets and preparing Inheriti® Business Protection Plans. Drop a file on the window or use **Choose files**. The app parses files locally and keeps imported values in memory while you review and edit entries. When you choose **Encrypt and stage**, it encrypts asset fields locally and sends the encrypted fields and plan draft to Inheriti® Business for staging.

```bash
yarn dev:dev
```

The importer detects formats from file contents as well as file names. Imported entries can be edited before staging: title, username, password, URL, group, tags, notes, and extra fields.

## Supported files and fields

### KeePass / KeePassXC `.kdbx`

Import a KeePass 2.x database directly. Enter its master password and provide a key file when prompted. The importer preserves the group path and reads title, username, password, URL, notes, tags, and nonempty custom text fields.

### 1Password `.1pux`

Import a 1Password `.1pux` export. Items with readable fields become entries grouped by vault name. The importer reads titles, URLs, notes, tags, designated login fields, and readable values from item sections. Field labels and values remain available for mapping to Plan assets. Review the resulting entries and field mappings before staging.

### Passbolt `.json` or `.csv`

Export passwords with secrets from Passbolt. JSON can contain a resource array, a single resource, or a `resources` array nested under `export`, `body`, or `data`. CSV uses a header row. The importer reads name/title, username, secret/password, URI/URL, description/notes, folder/group, tags, scalar extra fields, and additional scalar fields inside a JSON secret object.

Dedicated notes from KeePass, 1Password, and Passbolt fill **Notes or guidelines**, including on Plain Text fallbacks that also contain a secret value. These notes are asset metadata, so review them before staging. Notes found inside secret payloads stay in protected Plain Text assets for review.

### Kubernetes `.yaml`, `.yml`, or `.json`

Import `Secret` and `ConfigMap` resources as individual entries. The importer reads single objects, `List` objects with `items`, and multi-document YAML. Resource name becomes the title and namespace becomes the group. It reads `data`, `stringData`, and `binaryData`; text base64 values are decoded, and binary values are retained as base64 extra fields. Recognized keys such as username, password, URL, and notes fill standard fields; other keys become extra fields. Docker registry secrets also map the first registry's URL, username, and password.

### HashiCorp Vault `.json` or `.yaml`

Import `vault kv get -format=json` or `-format=yaml` output for KV v1 and KV v2, arrays of responses, or path-keyed multi-secret dumps. Each secret becomes an entry. A path supplies the title, group, and notes when present. Secret keys such as username, password, URL, and notes fill standard fields; other keys become extra fields.

### dotenv `.env`, `.env.*`, or `*.env`

Import `KEY=value` assignments, including `export` prefixes, quoted values, and multiline quoted values. Each nonempty variable becomes an entry titled with its key; the key and value are stored as an extra field. The file name supplies the group.

### Cloud secret `.json`

- **AWS Secrets Manager:** `get-secret-value` and `batch-get-secret-value` JSON with `SecretString` or `SecretBinary`. The secret name becomes the title and the ARN region becomes the group.
- **Azure Key Vault:** `az keyvault secret show --output json` with a secret `value`. The secret name becomes the title and the vault name becomes the group.
- **Google Secret Manager:** `gcloud secrets versions access --format=json` with `name` and base64 `payload.data`. The secret name becomes the title and the project path becomes the group.

For these cloud formats, a JSON object inside the secret value is expanded into fields. Recognized keys such as username, password, URL, and notes fill standard fields; other keys become extra fields. A plain text value is kept as an extra field named for the secret.

## Desktop environments and releases

The app has `dev`, `stg`, and `prod` environment definitions for its Business API and SafeID connections. Local development uses the ignored `.env.local` file.

```bash
yarn dev:dev
yarn dev:stg
yarn dev:prod
```

To build an installer for the current operating system:

```bash
yarn release:dev
yarn release:stg
yarn release:prod
```

Installers are written to `release/<environment>/`: AppImage on Linux, DMG on macOS, and NSIS on Windows.
