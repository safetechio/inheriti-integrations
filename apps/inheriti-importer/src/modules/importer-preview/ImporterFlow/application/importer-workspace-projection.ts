import { isAutomaticallyMappable } from '@modules/import/domain/structured-extra-fields';
import { isNoteDestinationPending } from '../../AssetReviewQueue/review-blockers';
import {
  assetStatusForIssues,
  getAssetReviewIssues,
} from '../../AssetReviewQueue/asset-review-issues';
import type { ImportSession } from '@modules/import/domain/import-model';
import {
  additionalFieldsAsset,
  bindingSourceIds,
} from '@modules/mapping/application/suggestion-engine';
import { sourceCoverage } from '@modules/mapping/application/source-coverage';
import {
  applyNativeNote,
  nativeNotes,
  noteForAsset,
  projectNoteSources,
  removeSourceBindings,
  type PreservationChoices,
} from './importer-workspace-notes';
import type { SuggestedAsset } from '@modules/mapping/domain/suggestion';
import type { WorkspaceState } from '@modules/plans/domain/workspace-model';
import { listPlanDrafts } from '@modules/plans/domain/workspace-selectors';
import { validatePlanForExecution } from '@modules/plans/domain/workspace-validation';
import { getPlanAssetIconName } from '@modules/plans/domain/asset-metadata';
import {
  hasIncludedSchemaField,
  type AssetReviewStatus,
  type ReviewAsset,
} from '../../AssetReviewQueue/types';
import type { GroupingAsset, PlanDraft as PreviewPlanDraft } from '../../PlanGroupingSurface';
import { projectAssets, reviewStatus } from './importer-workspace-review-projection';
import type {
  ImporterWorkspaceProjection,
  MappingOverrides,
  PlainTextOverrides,
  FieldOrganization,
} from './importer-workspace-types';
import {
  statusKey,
  applyMappingOverrides,
  convertToPlainText,
  sourceSuggestions,
  bindingUsesSource,
  suggestionFields,
  mappedFieldIds,
  assetMatchesSuggestion,
  plainTextValueWithoutNote,
  convertToCanonicalType,
} from './importer-workspace-suggestions';
import type { AssetTypeOverrides } from './importer-workspace-types';

function sourceLocation(session: ImportSession, fromNodeId: string) {
  const node = session.nodesById[fromNodeId];
  return {
    sourceId: node?.sourceId,
    folderPath: node?.path ?? [],
  };
}

// Apply review edits before building the visible asset rows.
export function projectSuggestions(
  session: ImportSession,
  found: SuggestedAsset[],
  mappingOverrides: MappingOverrides,
  plainTextOverrides: PlainTextOverrides,
  plainTextAssetIds: ReadonlySet<string>,
  typeOverrides: AssetTypeOverrides = {},
  choices: PreservationChoices = {},
  organization?: FieldOrganization,
  workspace?: WorkspaceState,
): SuggestedAsset[] {
  const originalIds = new Set(found.map(statusKey));
  const assignedAssets = new Map(
    workspace &&
      listPlanDrafts(workspace).flatMap((plan) => plan.assets.map((asset) => [asset.id, asset])),
  );
  const hasLegacyCompanion = (nodeId: string) => {
    const id = `${nodeId}:PLAIN-TEXT-ADDITIONAL`;
    return (
      originalIds.has(id) ||
      assignedAssets.has(id) ||
      Boolean(organization?.assets[id] || typeOverrides[id] || plainTextOverrides[id]) ||
      Object.hasOwn(mappingOverrides, id) ||
      plainTextAssetIds.has(id)
    );
  };
  const originalByNode = new Map<string, SuggestedAsset>();
  for (const candidate of found) {
    if (!candidate.id && !candidate.variant) originalByNode.set(candidate.fromNodeId, candidate);
  }
  const entries = new Map<string, SuggestedAsset[]>();
  for (const asset of [
    ...found,
    ...Object.values(organization?.assets ?? {}).filter((asset) => {
      if (originalIds.has(statusKey(asset)) || asset.variant) return false;
      const original = originalByNode.get(asset.fromNodeId);
      return !(
        original &&
        typeOverrides[statusKey(original)] === asset.type &&
        statusKey(asset) === `${asset.fromNodeId}:${asset.type}`
      );
    }),
  ]) {
    const group = entries.get(asset.fromNodeId) ?? [];
    group.push(asset);
    entries.set(asset.fromNodeId, group);
  }
  const projectOne = (suggestion: SuggestedAsset): SuggestedAsset => {
    const overridden = applyMappingOverrides(suggestion, mappingOverrides);
    const id = statusKey(suggestion);
    const hasSibling =
      entries.get(suggestion.fromNodeId)?.some((candidate) => statusKey(candidate) !== id) ||
      (!suggestion.variant && hasLegacyCompanion(suggestion.fromNodeId));
    const converted = typeOverrides[id]
      ? convertToCanonicalType(session, overridden, typeOverrides[id], hasSibling)
      : plainTextAssetIds.has(id)
        ? convertToPlainText(session, overridden, hasSibling)
        : overridden;
    let mapped =
      converted === overridden ? overridden : applyMappingOverrides(converted, mappingOverrides);
    const noteOverride = mappingOverrides[statusKey(converted)];
    if (mapped.type === 'PLAIN-TEXT' && noteOverride && Object.hasOwn(noteOverride, 'meta.notes')) {
      const originalNote = (converted !== overridden ? converted : suggestion).fieldBindings[
        'meta.notes'
      ];
      const valueBinding = plainTextValueWithoutNote(
        session,
        mapped,
        noteOverride['meta.notes'],
        originalNote?.kind === 'source' && originalNote.sourceFieldId !== noteOverride['meta.notes']
          ? originalNote.sourceFieldId
          : undefined,
      );
      const fieldBindings = { ...mapped.fieldBindings };
      if (valueBinding) fieldBindings['secret.text'] = valueBinding;
      else delete fieldBindings['secret.text'];
      mapped = { ...mapped, fieldBindings };
    }
    const name = organization?.names?.[id];
    if (name) mapped = { ...mapped, name };
    const value = plainTextOverrides[statusKey(converted)];
    if (converted.type !== 'PLAIN-TEXT' || !value) return mapped;
    return {
      ...mapped,
      fieldBindings: {
        ...mapped.fieldBindings,
        'secret.text': { kind: 'literal' as const, value },
      },
    };
  };
  const ownerFields = new Map(
    Object.entries(organization?.assets ?? {}).map(([id, asset]) => [
      id,
      mappedFieldIds(projectOne(asset)),
    ]),
  );
  const owned = Object.entries(organization?.owners ?? {}).filter(([field, id]) =>
    ownerFields.get(id)?.has(field),
  );
  const owners = new Map(owned);
  const ignored = choices.ignored ?? new Set<string>();
  const released = organization?.releasedFieldIds;
  const withoutForeignFields = (asset: SuggestedAsset) => {
    const id = statusKey(asset);
    return removeSourceBindings(
      asset,
      new Set(
        suggestionFields(session, asset)
          .filter(({ id: fieldId }) => {
            const owner = owners.get(fieldId);
            if (owner) return owner !== id;
            return (
              asset.type === 'PLAIN-TEXT' &&
              released?.has(fieldId) &&
              !Object.values(mappingOverrides[id] ?? {}).includes(fieldId)
            );
          })
          .map((field) => field.id),
      ),
    );
  };
  const rescuedIds = new Set(choices.rescued);
  return [...entries].flatMap(([nodeId, group]) => {
    const node = session.nodesById[nodeId];
    if (!node) return [];
    const noteOwner = nativeNotes(session, nodeId);
    const legacyText = assignedAssets.get(`${nodeId}:PLAIN-TEXT-ADDITIONAL`)?.fieldBindings[
      'secret.text'
    ];
    const noteAlreadyProtected = Boolean(
      legacyText && noteOwner && bindingUsesSource(legacyText, new Set([noteOwner.id])),
    );
    const nativeOwner = noteOwner && owners.get(noteOwner.id);
    const primaries = group
      .filter((asset) => !asset.variant)
      .map((asset, index) => {
        const projectedAsset = projectOne(organization?.assets[statusKey(asset)] ?? asset);
        const replacement =
          statusKey(asset) !== statusKey(projectedAsset)
            ? organization?.assets[statusKey(projectedAsset)]
            : undefined;
        const projected = withoutForeignFields(
          removeSourceBindings(replacement ? projectOne(replacement) : projectedAsset, ignored),
        );
        const reservedIds =
          index !== 0 && noteOwner && statusKey(projected) !== nativeOwner
            ? new Set([...rescuedIds, noteOwner.id])
            : rescuedIds;
        const withoutReserved = removeSourceBindings(projected, reservedIds);
        return index === 0 && !nativeOwner && !(noteOwner && reservedIds.has(noteOwner.id))
          ? applyNativeNote(session, withoutReserved, choices, noteAlreadyProtected)
          : withoutReserved;
      });
    const covered = new Set(primaries.flatMap((asset) => [...mappedFieldIds(asset)]));
    const fields = group.length ? suggestionFields(session, group[0]) : [];
    const remaining = fields.filter((field) => !covered.has(field.id) && !ignored.has(field.id));
    const rescueId = `${node.id}:PLAIN-TEXT-RESCUED`;
    const noteDecision =
      primaries[0] && noteForAsset(session, primaries[0], choices, noteAlreadyProtected);
    const protectedNote =
      noteDecision?.explicit && noteDecision.destination === 'protected' && !noteAlreadyProtected
        ? noteOwner?.id
        : undefined;
    const rescueFields = remaining.filter((field) => {
      const owner = owners.get(field.id);
      return (
        (rescuedIds.has(field.id) || field.id === protectedNote) && (!owner || owner === rescueId)
      );
    });
    const rescue = rescueFields.length
      ? {
          ...additionalFieldsAsset(session, node, rescueFields),
          variant: 'rescued-fields' as const,
          name:
            organization?.names?.[rescueId] ??
            organization?.assets[rescueId]?.name ??
            `${node.name} — ${rescueFields.length === 1 && rescueFields[0].id === noteOwner?.id ? 'Notes' : 'preserved fields'}`,
        }
      : undefined;
    const active = primaries.filter((asset, index) => {
      if (Object.keys(asset.fieldBindings).length) return true;
      if (
        index === 0 &&
        protectedNote &&
        rescueFields.length &&
        remaining.every(({ id }) => id === protectedNote || rescuedIds.has(id) || owners.has(id))
      )
        return false;
      return (
        asset.type !== 'PLAIN-TEXT' ||
        !fields.some((field) => owners.has(field.id)) ||
        (index === 0 &&
          ((noteOwner && !ignored.has(noteOwner.id) && choices.entryNotes?.[nodeId] === null) ||
            fields.some(({ id }) => released?.has(id) && !owners.has(id) && !ignored.has(id))))
      );
    });
    if (!hasLegacyCompanion(nodeId)) return rescue ? [...active, rescue] : active;

    const previouslyBound = new Set(legacyText ? bindingSourceIds(legacyText) : []);
    const fallback = additionalFieldsAsset(
      session,
      node,
      remaining.filter(
        (field) =>
          !rescuedIds.has(field.id) &&
          field.id !== protectedNote &&
          !(field.id === noteOwner?.id && choices.entryNotes?.[nodeId] === null) &&
          (isAutomaticallyMappable(field) || previouslyBound.has(field.id)),
      ),
    );
    const organizedCompanion = organization?.assets[statusKey(fallback)];
    const companionBase =
      organizedCompanion?.type === 'PLAIN-TEXT'
        ? {
            ...organizedCompanion,
            fieldBindings: {
              ...Object.fromEntries(
                Object.entries(organizedCompanion.fieldBindings).filter(
                  ([key]) => key !== 'secret.text',
                ),
              ),
              ...fallback.fieldBindings,
            },
          }
        : (organizedCompanion ?? fallback);
    const companion = withoutForeignFields(
      removeSourceBindings(
        projectOne(companionBase),
        new Set([...ignored, ...rescuedIds, ...covered]),
      ),
    );
    const metadata = companion.fieldBindings['meta.notes'];
    if (noteOwner && metadata && bindingUsesSource(metadata, new Set([noteOwner.id]))) {
      delete companion.fieldBindings['meta.notes'];
    }
    const companionId = statusKey(companion);
    const keepCompanion =
      Object.keys(companion.fieldBindings).length ||
      typeOverrides[companionId] ||
      Object.keys(mappingOverrides[companionId] ?? {}).length ||
      assignedAssets.has(companionId);
    return [...active, ...(keepCompanion ? [companion] : []), ...(rescue ? [rescue] : [])];
  });
}

/** Show accepted suggestions that have not been placed in a plan. */
function projectUnassigned(
  session: ImportSession,
  suggestions: SuggestedAsset[],
  workspace: WorkspaceState,
  decisions: Record<string, AssetReviewStatus>,
  reviews: ReviewAsset[],
): GroupingAsset[] {
  return suggestions
    .filter(
      (suggestion) =>
        reviewStatus(session, suggestion, workspace, decisions) === 'accepted' &&
        !listPlanDrafts(workspace).some((plan) =>
          plan.assets.some((asset) => assetMatchesSuggestion(session, asset, suggestion)),
        ),
    )
    .map((suggestion): GroupingAsset => ({
      id: statusKey(suggestion),
      name: suggestion.name,
      type: suggestion.type,
      iconName: getPlanAssetIconName(suggestion.type),
      source: session.sources.find(
        (item) => item.id === session.nodesById[suggestion.fromNodeId]?.sourceId,
      )?.fileName,
      ...sourceLocation(session, suggestion.fromNodeId),
      valid: reviews.some(
        (asset) =>
          asset.id === statusKey(suggestion) &&
          asset.status === 'accepted' &&
          hasIncludedSchemaField(asset),
      ),
    }));
}

/** Project plan validity and assigned asset labels for the preview. */
function projectPlans(
  session: ImportSession,
  workspace: WorkspaceState,
  suggestions: SuggestedAsset[],
): PreviewPlanDraft[] {
  return listPlanDrafts(workspace).map((plan): PreviewPlanDraft => {
    const validation = validatePlanForExecution(plan, session);
    const invalidAssetIds = new Set(validation.materialisationErrors.map((error) => error.assetId));
    return {
      id: plan.clientId,
      name: plan.name,
      description: plan.description,
      folderId: plan.folderId,
      sharingModel: plan.governance.sharingModel,
      sourceGroup: plan.sourceGroup,
      sourceName: session.sources.find((source) => source.id === plan.sourceGroup?.sourceId)
        ?.fileName,
      assets: plan.assets.length,
      capacity: `${plan.assets.length} / 10 Assets`,
      valid: validation.valid,
      assignedAssets: plan.assets.map((asset) => {
        const suggestion = suggestions.find((candidate) =>
          assetMatchesSuggestion(session, asset, candidate),
        );
        return {
          id: suggestion ? statusKey(suggestion) : asset.id,
          name: asset.name,
          type: asset.type,
          iconName: getPlanAssetIconName(asset.type),
          source: suggestion
            ? session.sources.find(
                (item) => item.id === session.nodesById[suggestion.fromNodeId]?.sourceId,
              )?.fileName
            : undefined,
          valid: !invalidAssetIds.has(asset.id),
          ...(suggestion ? sourceLocation(session, suggestion.fromNodeId) : {}),
        };
      }),
      governanceHint: validation.issues[0]?.message,
    };
  });
}

/** Build the review and plan preview from the same suggestions. */
export function projectImporterWorkspace(
  session: ImportSession,
  workspace: WorkspaceState,
  decisions: Record<string, AssetReviewStatus> = {},
  mappingOverrides: MappingOverrides = {},
  plainTextOverrides: PlainTextOverrides = {},
  plainTextAssetIds: ReadonlySet<string> = new Set(),
  typeOverrides: AssetTypeOverrides = {},
  choices: PreservationChoices = {},
  organization?: FieldOrganization,
  found = sourceSuggestions(session),
): ImporterWorkspaceProjection {
  const ignored = new Set(workspace.ignoredSourceFieldIds);
  choices = { ...choices, ignored };
  const suggestions = projectSuggestions(
    session,
    found,
    mappingOverrides,
    plainTextOverrides,
    plainTextAssetIds,
    typeOverrides,
    choices,
    organization,
    workspace,
  );
  const assets = projectAssets(
    session,
    suggestions,
    workspace,
    decisions,
    plainTextAssetIds,
    typeOverrides,
    mappingOverrides,
    choices,
    organization,
    found,
  );
  const unassigned = projectUnassigned(session, suggestions, workspace, decisions, assets);
  const plans = projectPlans(session, workspace, suggestions);
  const drafts = listPlanDrafts(workspace).flatMap((plan) => plan.assets);
  const draftIds = new Set(drafts.map((asset) => asset.id));
  const candidateIds = new Set(suggestions.map(statusKey));
  const legacyDrafts = drafts.filter((asset) => !candidateIds.has(asset.id));
  const accepted = new Set(
    assets.filter((asset) => asset.status === 'accepted').map((asset) => asset.id),
  );
  const excluded = new Set(
    assets.filter((asset) => asset.status === 'excluded').map((asset) => asset.id),
  );
  const excludedFields = new Set(ignored);
  for (const suggestion of suggestions) {
    if (!excluded.has(statusKey(suggestion))) continue;
    for (const id of mappedFieldIds(suggestion)) excludedFields.add(id);
  }
  const acceptedDrafts = suggestions
    .filter(
      (asset) =>
        accepted.has(statusKey(asset)) &&
        !draftIds.has(statusKey(asset)) &&
        !legacyDrafts.some((draft) => assetMatchesSuggestion(session, draft, asset)),
    )
    .map((asset) => ({
      id: statusKey(asset),
      type: asset.type,
      name: asset.name,
      fieldBindings: asset.fieldBindings,
    }));
  const executionCoverage = sourceCoverage(session, drafts, excludedFields);
  const coverage = sourceCoverage(session, [...drafts, ...acceptedDrafts], excludedFields);
  const noteSources = projectNoteSources(session, choices);
  const explicitlyExcluded = new Set(
    coverage.fields.filter((field) => field.status === 'excluded').map((field) => field.id),
  );
  const pendingNote = assets.some((asset) => isNoteDestinationPending(asset, explicitlyExcluded));
  const actualByField = new Map(executionCoverage.fields.map((field) => [field.id, field]));
  const reviewByField = new Map(coverage.fields.map((field) => [field.id, field]));
  const invalidate = (id: string) => {
    const actual = actualByField.get(id);
    const review = reviewByField.get(id);
    if (actual) actual.status = 'invalid';
    if (review) review.status = 'invalid';
    coverage.ready = false;
    executionCoverage.ready = false;
  };
  for (const asset of assets) {
    const note = asset.note;
    if (!note) continue;
    const field = actualByField.get(note.sourceFieldId);
    if (!field?.destinations.length) continue;
    const expected = note.destination === 'asset-notes' ? 'meta.notes' : 'secret.text';
    if (field.destinations.length !== 1 || field.destinations[0].fieldId !== expected)
      invalidate(field.id);
  }
  for (const id of ignored) {
    if (actualByField.get(id)?.destinations.length) invalidate(id);
  }
  const companionIds = new Set(suggestions.filter((asset) => asset.variant).map(statusKey));
  const validProposals = new Set<string>();
  for (const asset of assets) {
    if (asset.status === 'accepted' || asset.status === 'excluded') continue;
    for (const field of asset.schemaFields ?? []) {
      if (field.sourceFieldId && !field.validationError) validProposals.add(field.sourceFieldId);
    }
    const text = asset.schemaFields?.find(({ key }) => key === 'secret.text');
    if (text && !text.validationError) {
      for (const field of asset.plainTextSources ?? []) validProposals.add(field.id);
    }
  }
  for (const asset of assets) {
    const omitted = (asset.unmappedSourceFieldIds ?? []).flatMap((id) => {
      const field = reviewByField.get(id);
      return field ? [field] : [];
    });
    const preserved = omitted.filter(
      (field) =>
        (field.status === 'protected' || field.status === 'mapped') &&
        field.destinations.some((destination) => companionIds.has(destination.assetId)),
    );
    const unresolved = omitted.filter(
      ({ id, status }) => status === 'invalid' || (status === 'pending' && !validProposals.has(id)),
    );
    if (preserved.length) asset.preservedInCompanion = preserved.map((field) => field.name);
    asset.unmapped = unresolved.map((field) => field.name);
    asset.unmappedSourceFieldIds = unresolved.map((field) => field.id);
  }
  const byNode = <T>(items: T[], getNode: (item: T) => string | undefined) => {
    const groups = new Map<string, T[]>();
    for (const item of items) {
      const id = getNode(item);
      if (!id) continue;
      const group = groups.get(id);
      if (group) group.push(item);
      else groups.set(id, [item]);
    }
    return groups;
  };
  if (assets.some(({ status }) => status !== 'accepted' && status !== 'excluded')) {
    const fieldsByNode = byNode(coverage.fields, ({ nodeId }) => nodeId);
    const assetsByNode = byNode(assets, ({ sourceNodeId }) => sourceNodeId);
    for (const asset of assets) {
      if (asset.status === 'accepted' || asset.status === 'excluded' || !asset.sourceNodeId)
        continue;
      const nodeId = asset.sourceNodeId;
      const { issueCount } = getAssetReviewIssues(
        asset,
        (fieldsByNode.get(nodeId) ?? []).filter(({ sourceId }) => sourceId === asset.sourceId),
        (assetsByNode.get(nodeId) ?? []).filter(
          (sibling) => sibling !== asset && sibling.sourceId === asset.sourceId,
        ),
        [],
      );
      asset.status = assetStatusForIssues(asset, issueCount);
    }
  }
  coverage.ready &&= !pendingNote;
  executionCoverage.ready &&= !pendingNote;
  return { suggestions, assets, unassigned, plans, coverage, executionCoverage, noteSources };
}
