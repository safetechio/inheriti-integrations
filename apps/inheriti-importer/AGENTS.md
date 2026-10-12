# AGENTS.md

Guidance for Claude Code when working in **Inheriti Importer** — a small Electron
desktop app that imports external secret sources and turns them, after explicit
user review, into Inheriti Business Protection Plans.

## Documentation policy

Only durable "how it works" documentation belongs here (`docs/`, this file,
`README.md`). No plans, phase breakdowns, migration notes, or "what I did" files —
that goes in the PR/issue.

## Stack

Electron 36 · Vite 6 · React 19 · TypeScript 5.8 · Vitest 3. Renderer is
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; the only
bridge is `window.inheriti` from `electron/preload.cjs`.

UI is **`react-native-web`** with a small Importer-local, restyle-style prop
API (`@shopify/restyle` itself is not a dependency) — an **Importer-owned
design system**. Two layers:

- **Primitives + theme** (`Box`, `Text`, `Pressable`, `theme`) live in
  `src/modules/_shared/ui/theme/AppTheme.ts` and
  `.../components/index.tsx` — Importer-owned, matching Business visual
  tokens where it matters, not extracted from the SDK.
- **Asset editor logic** is Importer-owned under `src/modules/plans/ui/`.
- **Shell components** (`Button`, `Card`, `Stack`, …) are Importer-local, in
  `src/modules/_shared/ui/components/` (`@main-components`), built on the
  local primitives above. Business UI does not use these — it keeps its own
  `@main-components`.

Vite aliases `react-native` → `react-native-web`; `src/main.tsx` wraps the root
in the Importer's own theme/style provider.

## UI conventions

- **One component per folder: `SomeComponent/index.tsx`** (co-locate
  `hooks/`, `components/`, `*.test.tsx`, `testids.ts` beside it) — the
  `inheriti-business-ui` layout.
- **Never use raw HTML layout elements** (`div`, `span`, `ul`, `li`, `p`, `h*`)
  in components. Compose from `@main-components` (`Box` / `Text` / `Button` /
  `Card` / `Stack` / `Pressable`). Spacing, radius and colour are theme tokens
  (`padding="m"`, `borderRadius="s"`, `color="primary"`), not raw px.
- New shell components go under `src/modules/_shared/ui/components/**`; do not
  add a second design system.

## Component organization

Keep UI components small and organized:

- One component per file and one feature per folder.
- Split orchestration, rendering, and reusable behavior into separate hooks and components when a file grows beyond one clear responsibility.
- Colocate feature-specific hooks, subcomponents, tests, and test IDs under the feature folder.
- Keep entry-point files focused on public exports and composition; avoid putting large component implementations in them.
- Export internal components and hooks explicitly from the feature folder when they are reused or tested independently.

## Architecture

The app behaves like a deliberately small Business client. It uses
`@safetech/inheriti-core-sdk` for canonical crypto and Asset primitives, while
Importer-local adapters own auth, organisation context, and Business API calls.

### Layout

```
src/
  modules/
    _shared/        cross-module kernel (ports, error boundary, cleanup)
    auth/           login / logout / session UI
    organization/   owned-org selection, capability/policy/capacity gates
    import/         parser adapters -> normalized source model
    mapping/        source-field -> Asset-field workspace + suggestions
    plans/          Plan/Asset drafts, preflight, create/configure
    batch/          batch execution and staging UI

electron/           main + preload
```

Each `modules/<name>` uses `domain / application / infrastructure / ui`. The
existing parsers under `src/modules/import/infrastructure/parsers/` are **not rewritten** — `modules/import`
wraps them behind the `ImportParser` port.

### Key rules

- Renderer never receives tokens or cookies (those stay in the main
  process). The Organisation Key does transit renderer memory during a
  release/configure operation but must never be persisted there: see
  [`docs/adr/0001-organization-key-boundary.md`](docs/adr/0001-organization-key-boundary.md)
  and [`docs/security.md`](docs/security.md#secret-lifecycle).
- Imported secret values live in memory only — no `localStorage`, persisted
  store, logs, telemetry, or URLs.
- Parser/crypto libraries sit behind ports.
- All host access (file picker, secure storage) goes through allowlisted IPC.

## Where to look

| Task                      | Read                                         |
| ------------------------- | -------------------------------------------- |
| Overall design            | [docs/architecture.md](docs/architecture.md) |
| Desktop security boundary | [docs/security.md](docs/security.md)         |
| IPC contract              | [docs/electron-ipc.md](docs/electron-ipc.md) |
| Adding an import format   | [docs/import-model.md](docs/import-model.md) |
