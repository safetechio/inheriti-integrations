# Import model

## The port

`modules/import/domain/import-parser.ts` defines `ImportParser`:

```ts
interface ImportParser {
  canParse(fileName: string, data: ArrayBuffer): boolean;
  parse(input: ImportParseInput): Promise<ParsedImportSource>;
}
```

The mapping workspace depends only on this. It never imports a KeePass /
Kubernetes / etc. parser.

## The normalized tree

`modules/import/domain/import-model.ts`:

- **`ImportedSource`** — one imported file: `kind`, `name`, `fileName`,
  `importedAt`, `warnings`.
- **`ImportedNode`** — a `group` (folder / namespace) or an `entry` (one
  credential record); carries `path`, `childNodeIds`, `fieldIds`.
- **`ImportedField`** — one value: `name`, `sourcePath`, `value: SensitiveValue`,
  `detectedType?`, `metadata`.
- **`ImportSession`** — `{ sources, rootNodeIds, nodesById, fieldsById }`.

`SensitiveValue` masks its content in `toString` / `toJSON` and logs; reading the
real string is an explicit `.reveal()` call, so every read site is auditable.
`clearImportSession` wipes every field's value.

## Adapters

`modules/import/infrastructure/vault-file-import-parser.ts` wraps the existing,
tested parser pipeline (`src/modules/import/infrastructure/parsers`) (`detectVaultKind` + the six format parsers).
For each `ParseResult` it builds: one root group per source, a nested group per
`entry.group` path segment, one `entry` node per record, and one `ImportedField`
per non-empty field (`username` / `password` / `url` / `notes` / extra fields).

Adding a format: add a parser under `src/modules/import/infrastructure/parsers/` with its tests, wire it
into `detectVaultKind` and `parseVaultFile`, and the adapter maps it for free. A
format that doesn't fit the credential-record shape gets its own `ImportParser`
implementation.
