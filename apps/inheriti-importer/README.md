# Inheriti® Importer

Desktop importer for password vaults and secret exports. Files are parsed locally so you can review and edit entries before any later push into Inheriti® Business.

```bash
pnpm install
pnpm dev:dev
```

Drop a file on the window or use **Choose files**. The format is detected from the contents, not only the extension.

## Supported parsers

| Parser          | Typical files            | What it reads                                                      |
| --------------- | ------------------------ | ------------------------------------------------------------------ |
| KeePass         | `.kdbx`                  | KeePass / KeePassXC databases (password and optional key file)     |
| Passbolt        | `.json`, `.csv`          | Password export with secrets included                              |
| Kubernetes      | `.yaml`, `.yml`, `.json` | `Secret` and `ConfigMap` (including Lists and multi-document YAML) |
| HashiCorp Vault | `.json`, `.yaml`         | KV v1 and v2 `vault kv get` output, and multi-path dumps           |
| dotenv          | `.env`, `*.env`          | `KEY=value` environment files                                      |
| Cloud           | `.json`                  | AWS Secrets Manager, Azure Key Vault, Google Secret Manager        |

`username`, `password`, `url`, and similar keys are mapped to the standard entry fields. Other keys become extra fields.

---

## KeePass

Use the database file itself. No separate export step.

1. In KeePass or KeePassXC, save the database (`.kdbx`).
2. Import that file here.
3. If the database is locked, enter the master password. Add the key file when the database uses one.

Compatible with KeePass 2.x / KeePassXC `.kdbx` files. Recycle-bin entries are skipped.

---

## Passbolt

Export from the Passbolt web app so the file contains decrypted secrets.

1. Open the password workspace.
2. Select the passwords to export (or all passwords you are allowed to export).
3. Choose **Export**.
4. Pick **JSON** or **CSV**.
5. Include secrets / passwords in the export (you will be asked for your passphrase).
6. Save the file and import it here.

JSON may be a resource array, `{ "resources": [ ... ] }`, or a similar nested export. CSV should include columns such as `Name`, `Username`, `URI`, `Description`, and `Secret` / `Password`.

If passwords are missing after import, the export was created without secrets. Export again and include them.

---

## Kubernetes

Export Secret (or ConfigMap) objects with `kubectl`. Base64 `data` is decoded automatically.

One secret:

```bash
kubectl get secret db-credentials -n production -o yaml > db-credentials.yaml
kubectl get secret db-credentials -n production -o json > db-credentials.json
```

Every secret in a namespace:

```bash
kubectl get secrets -n production -o yaml > secrets.yaml
```

Every secret in the cluster:

```bash
kubectl get secrets -A -o json > all-secrets.json
```

Supported shapes:

- Single `Secret` or `ConfigMap`
- `kind: List` / `items` from `kubectl get secrets`
- Multi-document YAML (`---` separators)
- `Opaque`, `kubernetes.io/tls`, `kubernetes.io/dockerconfigjson`, and `kubernetes.io/basic-auth`
- `stringData` as well as `data`

Do not import SealedSecrets (they are still encrypted). Decrypt or unseal first, then export the resulting Secret.

---

## HashiCorp Vault

Export a KV secret as JSON (YAML is also accepted).

KV v2 (current default):

```bash
vault kv get -format=json secret/myapp > myapp.json
```

KV v1:

```bash
vault kv get -format=json secret/myapp > myapp.json
```

YAML:

```bash
vault kv get -format=yaml secret/myapp > myapp.yaml
```

`vault kv list` only lists names and cannot be imported. To dump several paths, get each secret and combine the JSON objects, for example:

```json
{
  "secret/ops/db": { "username": "root", "password": "..." },
  "secret/ops/vpn": { "password": "..." }
}
```

Or keep an array of `vault kv get -format=json` responses. KV v2 payloads (`data.data` + `metadata`) and KV v1 flat `data` maps are both recognised.

---

## dotenv

Import an environment file from the project or host.

Typical names: `.env`, `.env.local`, `.env.production`, `app.env`.

Expected lines:

```bash
DATABASE_URL=postgres://ada:s3cret@db/app
export API_KEY="abc 123"
HOST=example.com
```

Comments (`#`) and quoted values are supported. Each variable becomes its own entry (title = key, password = value).

macOS file dialogs often hide files that start with a dot. Drag `.env` onto the window, or rename a copy to `app.env` before using **Choose files**.

---

## Cloud vaults

Import the JSON from a **get/show/access** call that includes the secret value. List-only APIs (`list-secrets`, `secret list`) do not include values and cannot be imported.

### AWS Secrets Manager

```bash
aws secretsmanager get-secret-value \
  --secret-id prod/db \
  --output json > aws-secret.json
```

Several secrets at once:

```bash
aws secretsmanager batch-get-secret-value \
  --secret-id-list prod/db prod/api \
  --output json > aws-secrets.json
```

If `SecretString` is itself JSON (for example `{"username":"...","password":"..."}`), those keys are mapped onto the entry.

### Azure Key Vault

```bash
az keyvault secret show \
  --vault-name ops-vault \
  --name smtp \
  --output json > azure-secret.json
```

`az keyvault secret list` omits values. Use `secret show` for each secret you need.

### Google Secret Manager

```bash
gcloud secrets versions access latest \
  --secret=api-key \
  --project=my-project \
  --format=json > gcp-secret.json
```

The access payload should include `name` and `payload.data` (base64). Plaintext-only access output is not enough; keep `--format=json`.

---

## After import

Entries stay on this machine. You can edit title, username, password, URL, group, tags, notes, and extra fields, then revert local changes if needed. Nothing is uploaded until a later Inheriti® Business push is added.

## Environments and desktop releases

The importer has committed `dev`, `stg`, and `prod` environment definitions. Their Business API and SafeID settings mirror the corresponding Inheriti Business UI environments. Local development continues to use the ignored `.env.local` file.

Run the desktop app against a deployed environment:

```bash
pnpm dev:dev
pnpm dev:stg
pnpm dev:prod
```

Create an installer for the current operating system:

```bash
pnpm release:dev
pnpm release:stg
pnpm release:prod
```

Each command validates the required API, SafeID, and Business web CTA variables, builds both renderer and main-process configuration for that environment, and writes installers to `release/<environment>/`. Linux produces an AppImage, macOS a DMG, and Windows an NSIS installer.
