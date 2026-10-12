# Mapping workspace domain

`modules/plans/domain` + `modules/mapping/domain` hold the pure state of the
"map source fields onto Plan drafts" workspace. No React, no SDK.

## State

`WorkspaceState`:

- `planOrder` / `plansByClientId` — `PlanDraft`s in display order.
- `ignoredSourceFieldIds` — fields the user excluded.
- `revision` — bumped by every command; a fresh revision after cancel/completion
  so returning to edit is a new pass.

`PlanDraft` → `{ clientId, type: 'BACKUP', name, categoryId, teamIds, assets:
AssetDraft[], governance }`. `AssetDraft` → `{ id, type, name, fieldBindings }`.
`FieldBinding` is `{ kind: 'source', sourceFieldId }` or `{ kind: 'literal',
value: SensitiveValue }` — bindings **reference** source ids, they never copy a
secret into a second store. A selector materialises `DataAsset[]` only for
validation / configuration, then releases it.

## Commands

`modules/plans/domain/workspace-commands.ts` — every mutation is a pure
`(state, args) => WorkspaceState` that bumps `revision`:

`createPlan` · `renamePlan` · `setPlanCategory` · `setPlanTeams` · `removePlan` ·
`reorderPlans` · `createAsset` · `editAsset` · `removeAsset` · `moveAsset` ·
`bindField` · `unbindField` · `ignoreSourceField` · `unignoreSourceField`

DnD in the UI only ever emits these.

## Status machines

- **Source field** (`modules/mapping/domain/source-field-status.ts`):
  `MAPPED | PARTIALLY_MAPPED | UNMAPPED | IGNORED | INVALID`.
  `resolveSourceFieldStatus` takes the set of binding keys whose value failed
  Core validation and an `isAssetComplete` predicate.
- **Plan draft**: `EDITING | VALID | INVALID` — `planDraftView` collects issues
  (`NO_NAME`, `NO_ASSETS`, `ASSET_INCOMPLETE`, `POLICY_VIOLATION`,
  `STALE_REFERENCE`, `OVER_LIMIT`).
- **Per-Plan execution**: lives in the Importer's local batch executor
  (`PENDING … COMPLETE / FAILED_CREATE / FAILED_CONFIGURE / CANCELLED`).

## Selectors

`workspace-selectors.ts` — `listPlanDrafts`, `boundSourceFieldIds`,
`planDraftView`, `workspaceSummary`.
