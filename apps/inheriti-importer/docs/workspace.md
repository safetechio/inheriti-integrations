# Mapping workspace domain

`modules/plans/domain` + `modules/mapping/domain` hold the pure state of the
"map source fields onto Plan drafts" workspace. No React, no SDK.

## State

`WorkspaceState`:

- `planOrder` / `plansByClientId` — `PlanDraft`s in display order.
- `ignoredSourceFieldIds` — fields the user excluded.
- `revision` — bumped by every command; a fresh revision after cancel/completion
  so returning to edit is a new pass.

`PlanDraft` → `{ clientId, type: 'BACKUP', name, description, teamIds, assets:
AssetDraft[], governance }`. `AssetDraft` → `{ id, type, name, fieldBindings }`.
`FieldBinding` is `{ kind: 'source', sourceFieldId }` or `{ kind: 'literal',
value: SensitiveValue }` — bindings **reference** source ids, they never copy a
secret into a second store. A selector materialises `DataAsset[]` only for
validation / configuration, then releases it.

## Commands

`modules/plans/domain/workspace-commands.ts` — every mutation is a pure
`(state, args) => WorkspaceState` that bumps `revision`:

`createPlan` · `renamePlan` · `updatePlanMetadata` · `setPlanTeams` · `removePlan` ·
`reorderPlans` · `createAsset` · `editAsset` · `removeAsset` · `moveAsset` ·
`bindField` · `unbindField` · `ignoreSourceField` · `unignoreSourceField`

DnD in the UI only ever emits these.

`workspace-bulk-commands.ts` moves or unassigns a selection in one revision.
It checks the complete batch against the current workspace before changing it;
an invalid selection or insufficient capacity leaves the workspace unchanged.
Moving an assigned asset preserves its existing draft and field bindings.

## Review and history

Step 2 accepts all pending eligible assets across sources and filters with
**Accept all eligible** or **Ctrl/Cmd+Shift+A**. Excluded, accepted, and invalid
assets keep their status. Undo restores the latest batch, preserving subsequent
individual review or mapping changes.

Step 3 supports checkbox selection, Ctrl/Cmd-click, Shift ranges, and scoped
Ctrl/Cmd+A. The selection can be moved with the destination control or dragged
as a group. Plan commands create one undo entry per batch. Review decisions and
mapping overrides are separate from plan snapshots, so editing the review clears
plan Undo/Redo history; an old snapshot cannot restore an excluded asset.

Plan categories are no longer queried or emitted by the Importer. Provider
classification metadata remains part of the source format and is independent
of plan organization.

## Source grouping

**Group unassigned assets** creates plans only for accepted, valid assets that
are still unassigned. It groups by source ID and, when selected, exact source
folder segments, splitting each group at the current plan capacity. Existing
plans, assignments, names and descriptions are preserved. Only the untouched
automatically created empty placeholder is replaced. One grouping action is
one history entry; repeating it with no remaining eligible assets is a no-op.

`PlanDraft.sourceGroup` records local origin metadata for the navigator. It is
not a Business folder identifier and is not sent as a destination in staging.
KeePass imports retain exact `groupPath` segments separately from the display
`group` text. The session adapter normalizes legacy KeePass display paths at
the import boundary; already flattened legacy names containing ` / ` remain
ambiguous. Other provider group names are treated as opaque names.

Without a folder adapter, isolated previews retain the original plan-card view.
The connected wizard uses the two trees described below. Ctrl/Cmd+A selects all
matching source assets, including rows not yet rendered; Shift ranges follow
visible tree order and exclude collapsed branches.

## Organisation destinations

Create plans uses two trees: source assets and the organisation folder catalog.
Source identity and exact folder segments are preserved; folder selections include
the whole subtree. Lists mount a bounded initial page, with explicit load more.
The step rail, stage header, panel toolbars, selection actions and footer stay
visible while each tree scrolls independently.

The importer uses `/integrations/v1/organizations/:organizationId/plan-folders`
for catalog reads and folder creation, plus `PATCH /:id` for revision-checked
renames. These routes use the Elements operator and organisation guards and
reuse Business commands, permissions and subscription checks. Tokens stay in
Electron main. Inline edits commit with Enter or focus leaving the editor;
Escape cancels. Shared root creation can explicitly choose teams; subfolders
inherit their parent's effective policy. A shared destination without a policy
must be configured in Business before receiving plans.

Shared and private catalogs are distinct. Plans retain their explicit `folderId`
in the workspace and staging payload. Business promotion resolves it through
the canonical folder-aware creation flow, checking current access and policy
again. Source paths and `sourceGroup` never become remote folder identifiers.
Folder creates and renames are server mutations; local Undo/Redo covers workspace
plan/asset changes, not those remote operations.

Core SDK owns the SVG catalog under its `ui-assets` subpath. The Importer and
Business render with their own components and generated static package asset
references. Neither app maintains a second copy of the SVG files.

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
