# Architecture

## What the app does

Imports external secret sources (KeePass, Passbolt, Kubernetes, HashiCorp Vault,
dotenv, cloud secret managers), lets the user map their fields onto typed Assets
across many Plan drafts, then stages encrypted drafts for later promotion in
Business UI.

## Composition

```
Importer  ─ composes ─>  @safetech/inheriti-core-sdk
```

- **Core SDK** — canonical Assets, validation, Plan create/configure use cases,
  crypto, shares.
- **Importer** — parser adapters, the normalized source model, the mapping
  workspace, auth/session and organisation API adapters, Organisation Key
  acquisition, batch execution, and the Electron host adapters.

The provider tree mounts `CoreProvider` → `QueryClientProvider` →
`ImporterApiProvider`, then the Importer's theme and host UI providers. The host
supplies the IPC transport, in-memory Organisation Key vault, and socket bridge.

## UI

`react-native-web`, in two Importer-owned layers:

- **Primitives + theme** — `Box`, `Text`, `Pressable`, `theme`, `StylesProvider`.
- **Shell components** — `Button`, `Card`, `Stack`, … Importer-local under
  `src/modules/_shared/ui/components/` (`@main-components`), built on those
  primitives.

`src/main.tsx` wraps the tree in the Importer's style provider and theme;
`vite.config.ts` aliases `react-native` → `react-native-web`. No raw
DOM layout elements (`div`/`span`/`ul`/`li`) in components; one
`Component/index.tsx` folder each.

## Modules

| Module         | Responsibility                                                       |
| -------------- | -------------------------------------------------------------------- |
| `_shared`      | ports, error boundary, secure-cleanup controller, host adapters      |
| `auth`         | login / logout / session-restore UI                                 |
| `organization` | owned-org selector, capability / policy / capacity gates             |
| `import`       | parser adapters → normalized `ImportedSource` tree                   |
| `mapping`      | source-field → Asset-field workspace, deterministic suggestions      |
| `plans`        | Plan / Asset drafts, preflight validation, materialise `DataAsset[]` |
| `batch`        | batch execution and staging UI                                       |

Each uses `domain / application / infrastructure / ui`. Navigation, layout, and
screen state stay in the Importer; reusable create/configure operations return
results and the host decides where to go next.

## Parsers

`src/modules/import/infrastructure/parsers/` holds the existing, tested format parsers. They are wrapped by
`modules/import`, not rewritten. `detectVaultKind` picks the format; each parser
returns a `ParseResult` which the adapter maps into the normalized tree.
