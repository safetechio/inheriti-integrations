import { isAutomaticallyMappable } from '@modules/import/domain/structured-extra-fields';
import {
  SensitiveValue,
  type ImportedField,
  type ImportedNode,
} from '@modules/import/domain/import-model';
import {
  allFieldsAsPlainText,
  bindingSourceIds,
  suggestEntryFields,
} from '@modules/mapping/application/suggestion-engine';
import { FieldAliasSuggestionStrategy } from '@modules/mapping/application/strategies/field-alias-strategy';
import type { SuggestedAsset, SuggestedFieldBinding } from '@modules/mapping/domain/suggestion';
import {
  getImportablePlanAssetTypes,
  getPlanAssetFormFields,
} from '@modules/plans/domain/asset-metadata';
import type { WorkspaceState } from '@modules/plans/domain/workspace-model';
import { listPlanDrafts } from '@modules/plans/domain/workspace-selectors';
import type {
  FieldOperationGroup,
  FieldOperationPreview,
  FieldOperationRequest,
  FieldOperationResult,
} from '../../AssetReviewQueue/field-operations';
import { hasIncludedSchemaField } from '../../AssetReviewQueue/types';
import { nativeNotes, type PreservationChoices } from './importer-workspace-notes';
import { projectSuggestions } from './importer-workspace-projection';
import { projectAssets, suggestionValidationErrors } from './importer-workspace-review-projection';
import {
  assetMatchesSuggestion,
  mappedFieldIds,
  sourceSuggestions,
  statusKey,
  suggestionFields,
} from './importer-workspace-suggestions';
import type {
  FieldOrganization,
  MappingOverrides,
  ReviewDecisions,
} from './importer-workspace-types';
import type { ImporterWorkspaceContext } from './use-importer-workspace';

export interface FieldOperationChange {
  organization: FieldOrganization;
  preservation: PreservationChoices;
  mappings: MappingOverrides;
  decisions: ReviewDecisions;
  workspace: WorkspaceState;
  result: FieldOperationResult;
}

export const failedFieldOperation = (message: string): FieldOperationResult => ({
  success: false,
  message,
  createdAssetIds: [],
  changedAssetIds: [],
});

type Context = Pick<
  ImporterWorkspaceContext,
  | 'session'
  | 'workspace'
  | 'preservation'
  | 'projection'
  | 'mappingOverrides'
  | 'plainTextOverrides'
  | 'plainTextAssetIds'
  | 'typeOverrides'
  | 'organization'
>;

const textKey = 'secret.text';
const plain = 'PLAIN-TEXT';
const targets = (type: string) =>
  getPlanAssetFormFields(type)
    .map((field) => field.source)
    .filter((key) => key.startsWith('secret.'));

function nameDerivedGroups(
  groups: FieldOperationGroup[],
  base: string,
  siblings: readonly SuggestedAsset[],
): FieldOperationGroup[] {
  const nameKey = (name: string) => name.trim().toLowerCase();
  const reserved = new Set([
    ...siblings.map(({ name }) => nameKey(name)),
    ...groups.filter(({ automaticName }) => !automaticName).map(({ name }) => nameKey(name)),
  ]);
  const baseName = base.trim() || 'Imported asset';
  let number = 1;
  return groups.map((group) => {
    if (!group.automaticName) return group;
    let name: string;
    do {
      const suffix = ` — Additional ${number++}`;
      const prefix = baseName
        .slice(0, 160 - suffix.length)
        .replace(/[\uD800-\uDBFF]$/, '')
        .trimEnd();
      name = prefix + suffix;
    } while (reserved.has(nameKey(name)));
    reserved.add(nameKey(name));
    return { ...group, name };
  });
}

export function planFieldOperation(
  context: Context,
  decisions: ReviewDecisions,
  request: FieldOperationRequest,
): { preview: FieldOperationPreview; change?: FieldOperationChange } {
  const { session, projection, workspace } = context;
  const operationId = request.operationId ?? crypto.randomUUID();
  const preview: FieldOperationPreview = {
    request: { ...request, operationId },
    token: Symbol(),
    groups: [],
    assets: [],
    errors: [],
    canConfirm: false,
    affectedEntryCount: 0,
    compatibleEntryCount: 0,
    skippedEntryCount: 0,
    movedFieldCount: 0,
    remainingFieldCount: 0,
  };
  const fail = (error: string, groupId?: string) => {
    preview.errors.push(error);
    if (groupId !== undefined) preview.groupErrors = { [groupId]: error };
    return { preview };
  };
  const explicit = request.entries !== undefined;
  const detecting = request.action === 'detect';
  const creatingWithSuggestions = request.action === 'create' && request.type === undefined;
  if (detecting && request.repeatCompatible)
    return fail('Suggest assets only applies to the selected unassigned fields.');
  const scope = request.entries ?? [request];
  const duplicate = request.action === 'duplicate-text';
  const moving = request.action === 'move';
  if (!/^[\w-]+$/.test(operationId)) return fail('The operation identity is invalid.');
  if (explicit) {
    if (request.repeatCompatible)
      return fail('Choose an explicit selection or repeat across compatible entries.');
    if (duplicate) return fail('Duplicate edited Plain Text from its own entry.');
    const selectedFields = scope.flatMap(({ fieldIds }) => fieldIds);
    const selectedIds = new Set(selectedFields);
    if (
      scope[0]?.sourceAssetId !== request.sourceAssetId ||
      selectedIds.size !== selectedFields.length ||
      selectedIds.size !== request.fieldIds.length ||
      new Set(request.fieldIds).size !== selectedIds.size ||
      request.fieldIds.some((id) => !selectedIds.has(id))
    ) {
      return fail('The selected fields no longer match the selected entries.');
    }
    preview.remainingFieldCount = selectedIds.size;
  }

  const byNode = new Map<string, SuggestedAsset[]>();
  const byId = new Map<string, SuggestedAsset>();
  const mappedById = new Map<string, Set<string>>();
  const excludedFieldIds = new Set(context.workspace.ignoredSourceFieldIds);
  for (const asset of projection.suggestions) {
    const id = statusKey(asset);
    const mapped = mappedFieldIds(asset);
    byId.set(id, asset);
    mappedById.set(id, mapped);
    if (decisions[id] === 'excluded') for (const fieldId of mapped) excludedFieldIds.add(fieldId);
    const siblings = byNode.get(asset.fromNodeId) ?? [];
    siblings.push(asset);
    byNode.set(asset.fromNodeId, siblings);
  }
  const knownTypes = new Set<string>(getImportablePlanAssetTypes());
  const unresolvedIds =
    explicit || detecting
      ? new Set(
          projection.coverage.fields
            .filter(({ status }) => status === 'pending' || (!detecting && status === 'invalid'))
            .map(({ id }) => id),
        )
      : undefined;
  const notesByNode = new Map<string, ImportedField | undefined>();
  const entryNote = (nodeId: string) => {
    if (!notesByNode.has(nodeId)) notesByNode.set(nodeId, nativeNotes(session, nodeId));
    return notesByNode.get(nodeId);
  };
  const available = (origin: SuggestedAsset): ImportedField[] => {
    const originId = statusKey(origin);
    if (decisions[originId] === 'excluded') return [];
    const siblings = byNode.get(origin.fromNodeId) ?? [];
    const canonical = new Set(
      siblings
        .filter((item) => item.type !== plain)
        .flatMap((item) => [...(mappedById.get(statusKey(item)) ?? [])]),
    );
    const refs =
      origin.type === plain
        ? new Set(
            origin.fieldBindings[textKey] ? bindingSourceIds(origin.fieldBindings[textKey]) : [],
          )
        : undefined;
    const otherPlainFields =
      refs || explicit || detecting
        ? new Set(
            siblings
              .filter((asset) => asset.type === plain && asset !== origin)
              .flatMap((asset) => [...(mappedById.get(statusKey(asset)) ?? [])]),
          )
        : undefined;
    const notes = entryNote(origin.fromNodeId);
    const originMapped = mappedById.get(originId);
    const hasBoundNote =
      notes &&
      siblings.some(
        (asset) =>
          asset.fieldBindings['meta.notes']?.kind === 'source' &&
          asset.fieldBindings['meta.notes'].sourceFieldId === notes.id,
      );
    return suggestionFields(session, origin).filter(
      (field) =>
        field.parentNodeId === origin.fromNodeId &&
        field.sourceId === session.nodesById[origin.fromNodeId]?.sourceId &&
        !field.value.isEmpty &&
        !excludedFieldIds.has(field.id) &&
        !canonical.has(field.id) &&
        (!unresolvedIds || (unresolvedIds.has(field.id) && !otherPlainFields?.has(field.id))) &&
        (!(explicit || detecting) ||
          context.organization.owners[field.id] === originId ||
          !mappedById.get(context.organization.owners[field.id])?.has(field.id)) &&
        (refs
          ? refs.has(field.id) || !otherPlainFields?.has(field.id)
          : !originMapped?.has(field.id)) &&
        (!hasBoundNote || notes.id !== field.id),
    );
  };
  const primaryName = (entry: ImportedNode, siblings: readonly SuggestedAsset[]) =>
    siblings.find((asset) => !asset.variant && !statusKey(asset).startsWith(`${entry.id}:ASSET-`))
      ?.name ?? entry.name;

  function defaultGroup(
    node: ImportedNode,
    selected: ImportedField[],
    target?: SuggestedAsset,
  ): FieldOperationGroup {
    const creatingSeveral = request.action === 'suggest';
    const proposals =
      !request.groups && ((request.action === 'create' && request.type) || moving)
        ? suggestEntryFields(
            [new FieldAliasSuggestionStrategy()],
            {
              session,
              nodeIds: [node.id],
              knownAssetTypes: knownTypes,
            },
            node,
            selected,
          ).filter((item) => item.type !== plain && !item.variant)
        : [];
    const type =
      creatingSeveral || (explicit && request.action === 'plain-text')
        ? plain
        : (target?.type ?? request.type ?? plain);
    const proposal = proposals.find((item) => item.type === type);
    const group: FieldOperationGroup = {
      id: target ? statusKey(target) : `${node.id}:ASSET-${operationId}-0`,
      nodeId: node.id,
      type,
      name: target?.name ?? '',
      automaticName: !target,
      fieldBindings: proposal
        ? Object.fromEntries(
            Object.entries(proposal.fieldBindings).flatMap(([key, binding]) =>
              key.startsWith('secret.') && binding.kind === 'source'
                ? [[key, binding.sourceFieldId]]
                : [],
            ),
          )
        : {},
    };
    if (type === plain && !duplicate && (!creatingSeveral || scope.length > 1))
      group.fieldBindings[textKey] = selected.map((field) => field.id);
    if (type !== plain && !Object.keys(group.fieldBindings).length && selected.length === 1) {
      const [key] = targets(type).filter((key) => !target?.fieldBindings[key]);
      if (key) group.fieldBindings[key] = selected[0].id;
    }
    if (target) {
      group.fieldBindings = Object.fromEntries(
        Object.entries(group.fieldBindings).filter(
          ([key]) => type === plain || !target.fieldBindings[key],
        ),
      );
    }
    if (moving && !target) group.fieldBindings = {};
    return group;
  }

  const groupsByNode = new Map<string, FieldOperationGroup[]>();
  if (explicit) {
    for (const group of request.groups ?? []) {
      const groups = groupsByNode.get(group.nodeId) ?? [];
      groups.push(group);
      groupsByNode.set(group.nodeId, groups);
    }
  }
  const entries = new Map<
    string,
    {
      source: SuggestedAsset;
      node: ImportedNode;
      target?: SuggestedAsset;
      selected: Map<string, ImportedField>;
      groups: FieldOperationGroup[];
    }
  >();
  if (explicit) preview.entries = [];
  for (const input of scope) {
    const source = byId.get(input.sourceAssetId);
    const node = source && session.nodesById[source.fromNodeId];
    const label = node?.name || source?.name || input.sourceAssetId;
    const error = (message: string) =>
      preview.errors.push(explicit ? `${label}: ${message}` : message);
    if (!source || !node) {
      error('The source asset is no longer available.');
      continue;
    }
    if (entries.has(node.id)) {
      error('Select one source asset per entry.');
      continue;
    }
    preview.entries?.push({ ...input, nodeId: node.id, sourceId: node.sourceId, name: label });
    if (decisions[input.sourceAssetId] === 'excluded') {
      error('The source asset is no longer available.');
      continue;
    }
    const originalText = source.fieldBindings[textKey];
    const candidate = moving && input.targetAssetId ? byId.get(input.targetAssetId) : undefined;
    const target =
      candidate &&
      decisions[statusKey(candidate)] !== 'excluded' &&
      candidate.fromNodeId === node.id &&
      (statusKey(candidate) !== input.sourceAssetId || candidate.type !== plain) &&
      candidate.fieldBindings[textKey]?.kind !== 'literal'
        ? candidate
        : undefined;
    if (moving && !target) {
      error('Choose a compatible asset from the same entry.');
      if (!explicit) return { preview };
    }
    if (
      duplicate
        ? originalText?.kind !== 'literal' || !originalText.value.reveal().trim()
        : originalText?.kind === 'literal'
    ) {
      error(
        duplicate
          ? 'Whole text duplication requires an edited Plain Text value.'
          : 'Edited Plain Text can only be duplicated as a whole.',
      );
      continue;
    }

    const selectedIds = new Set(input.fieldIds);
    const selected = available(source).filter((field) => selectedIds.has(field.id));
    if (!duplicate && (!selected.length || selected.length !== selectedIds.size)) {
      error(
        explicit
          ? 'Selected fields must belong to this entry and be available. Excluded, mapped or already proposed fields cannot be organized here.'
          : 'Select source fields that are available for this operation.',
      );
      continue;
    }

    const groups = request.groups
      ? explicit
        ? (groupsByNode.get(node.id) ?? [])
        : request.groups
      : detecting || creatingWithSuggestions
        ? suggestEntryFields(
            [new FieldAliasSuggestionStrategy()],
            { session, nodeIds: [node.id], knownAssetTypes: knownTypes },
            node,
            selected,
          )
            .filter((suggestion) => !creatingWithSuggestions || suggestion.type !== plain)
            .map((suggestion, index) => ({
              id: `${node.id}:ASSET-${operationId}-${index}`,
              nodeId: node.id,
              type: suggestion.type,
              name: '',
              automaticName: true,
              rationale: suggestion.rationale,
              fieldBindings: Object.fromEntries(
                Object.entries(suggestion.fieldBindings).flatMap(([key, binding]) => {
                  if (!key.startsWith('secret.')) return [];
                  const ids = bindingSourceIds(binding);
                  return ids.length ? [[key, binding.kind === 'sources' ? ids : ids[0]]] : [];
                }),
              ),
            }))
        : [defaultGroup(node, selected, target)];
    if (!request.groups && creatingWithSuggestions) {
      const mapped = new Set(
        groups.flatMap(({ fieldBindings }) => Object.values(fieldBindings).flat()),
      );
      const unmatched = selected.filter(({ id }) => !mapped.has(id));
      if (unmatched.length) {
        groups.push({
          ...defaultGroup(node, unmatched),
          id: `${node.id}:ASSET-${operationId}-${groups.length}`,
        });
      }
    }
    const siblings = byNode.get(node.id) ?? [];
    const base =
      input.sourceAssetId.startsWith(`${node.id}:ASSET-`) || source.variant
        ? primaryName(node, siblings)
        : source.name;
    const namedGroups = moving ? groups : nameDerivedGroups(groups, base, siblings);
    preview.groups.push(...namedGroups);
    entries.set(node.id, {
      node,
      source,
      target,
      selected: new Map(selected.map((field) => [field.id, field])),
      groups: namedGroups,
    });
    if (!namedGroups.length)
      error(
        detecting
          ? 'No complete structured asset was found in the selected fields.'
          : 'Add a destination asset for the selected fields.',
      );
    else if (
      (moving ||
        duplicate ||
        (explicit &&
          (request.action === 'plain-text' ||
            (request.action === 'create' && !creatingWithSuggestions)))) &&
      namedGroups.length !== 1
    )
      error('Choose one destination asset.');
  }
  if (preview.errors.length) return { preview };
  for (const nodeId of groupsByNode.keys()) {
    if (!entries.has(nodeId)) {
      const name = session.nodesById[nodeId]?.name ?? nodeId;
      return fail(`${name}: One destination belongs to an entry outside the selection.`);
    }
  }
  const organization = {
    ...context.organization,
    assets: { ...context.organization.assets },
    owners: { ...context.organization.owners },
    generatedAssetIds: new Set(context.organization.generatedAssetIds),
    releasedFieldIds: new Set(context.organization.releasedFieldIds),
  };
  const mappings = { ...context.mappingOverrides };
  const preservation = {
    ...context.preservation,
    rescued: new Set(context.preservation.rescued),
    entryNotes: { ...context.preservation.entryNotes },
  };
  const destinations = new Map<string, SuggestedAsset>();
  const used = new Set<string>();
  const movedDestinationIds = new Set<string>();

  function buildGroup(
    group: FieldOperationGroup,
    entry: ImportedNode,
    id: string,
    fields: ReadonlyMap<string, ImportedField>,
    usedFields: Set<string>,
    target?: SuggestedAsset,
    originalText?: SuggestedFieldBinding,
  ): SuggestedAsset | undefined {
    if (
      !knownTypes.has(group.type) ||
      !group.name.trim() ||
      (target && group.type !== target.type) ||
      ((duplicate || (explicit && request.action === 'plain-text')) && group.type !== plain)
    )
      return;
    const fieldBindings: Record<string, SuggestedFieldBinding> = { ...target?.fieldBindings };
    if (duplicate && originalText?.kind === 'literal') fieldBindings[textKey] = originalText;
    const allowed = new Set(targets(group.type));
    const noteId = entryNote(entry.id)?.id;
    for (const [key, value] of Object.entries(group.fieldBindings)) {
      if (!allowed.has(key)) return;
      const ids = Array.isArray(value) ? value : value ? [value] : [];
      if (duplicate) return;
      if (!ids.length) continue;
      if (
        ids.some((fieldId) => {
          const field = fields.get(fieldId);
          return (
            !field || usedFields.has(fieldId) || (detecting && !isAutomaticallyMappable(field))
          );
        })
      )
        return;
      if (new Set(ids).size !== ids.length) return;
      if (group.type === plain && key === textKey && !duplicate) {
        const binding = fieldBindings[textKey];
        const allIds = new Set([...ids, ...(binding ? bindingSourceIds(binding) : [])]);
        fieldBindings[key] = allFieldsAsPlainText(
          session,
          entry,
          entry.fieldIds.filter((id) => allIds.has(id)).map((id) => session.fieldsById[id]),
        ).fieldBindings[key];
      } else {
        const previous = fieldBindings[key];
        if (
          ids.length !== 1 ||
          Array.isArray(value) ||
          ids[0] === noteId ||
          (previous && (previous.kind !== 'source' || previous.sourceFieldId !== ids[0]))
        )
          return;
        fieldBindings[key] = { kind: 'source', sourceFieldId: ids[0] };
      }
      ids.forEach((fieldId) => usedFields.add(fieldId));
    }
    return {
      ...target,
      id,
      type: group.type,
      name: target?.name ?? group.name.trim(),
      fromNodeId: entry.id,
      confidence: 0,
      rationale: 'Organized from selected source fields during review.',
      fieldBindings,
    };
  }

  for (const { node, source, target, selected, groups: template } of entries.values()) {
    const error = (message: string) => (explicit ? `${node.name}: ${message}` : message);
    for (const [index, group] of template.entries()) {
      const prefix = `${node.id}:ASSET-${operationId}-`;
      if (
        group.nodeId !== node.id ||
        destinations.has(group.id) ||
        (target
          ? group.id !== statusKey(target)
          : !group.id.startsWith(prefix) ||
            !/^[\w-]+$/.test(group.id.slice(prefix.length)) ||
            byId.has(group.id) ||
            organization.assets[group.id])
      )
        return fail(error('One destination is no longer available.'));
      const before = used.size;
      const asset = buildGroup(
        group,
        node,
        group.id,
        selected,
        used,
        target,
        source.fieldBindings[textKey],
      );
      if (!asset || (!duplicate && used.size === before))
        return fail(error(`Map valid source fields in destination ${index + 1}.`), group.id);
      destinations.set(group.id, asset);
      if (target) movedDestinationIds.add(group.id);
    }
  }
  const skippedNodeIds: string[] = [];
  let compatible = entries.size;
  if (request.repeatCompatible && !moving && !duplicate) {
    const [{ node, source, groups: template }] = entries.values();
    const names = new Map([...used].map((id) => [id, session.fieldsById[id].name]));
    const sourceFields = suggestionFields(session, source);
    const unique = [...names.values()].every(
      (name) => sourceFields.filter((field) => field.name === name).length === 1,
    );
    if (!unique) {
      return fail('The source entry has ambiguous field names. Repeat requires unique names.');
    }
    for (const entry of Object.values(session.nodesById)) {
      if (entry.kind !== 'entry' || entry.id === node.id || entry.sourceId !== node.sourceId)
        continue;
      const siblings = byNode.get(entry.id) ?? [];
      const availableById = new Map(siblings.flatMap(available).map((field) => [field.id, field]));
      const entryFields = entry.fieldIds.map((id) => session.fieldsById[id]).filter(Boolean);
      const matched = new Map<string, string>();
      for (const [id, name] of names) {
        const matches = entryFields.filter((field) => field.name === name);
        if (
          matches.length !== 1 ||
          !availableById.has(matches[0].id) ||
          !isAutomaticallyMappable(matches[0])
        )
          continue;
        const [field] = matches;
        const ownerId = organization.owners[field.id];
        if (!mappedById.get(ownerId)?.has(field.id)) matched.set(id, field.id);
      }
      const usedHere = new Set<string>();
      const assets =
        matched.size === names.size
          ? nameDerivedGroups(template, primaryName(entry, siblings), siblings).map((group) =>
              buildGroup(
                {
                  ...group,
                  fieldBindings: Object.fromEntries(
                    Object.entries(group.fieldBindings).map(([key, binding]) => [
                      key,
                      Array.isArray(binding)
                        ? binding.map((id) => matched.get(id)!)
                        : matched.get(binding)!,
                    ]),
                  ),
                },
                entry,
                `${entry.id}${group.id.slice(node.id.length)}`,
                availableById,
                usedHere,
              ),
            )
          : [];
      const complete = assets.filter((asset): asset is SuggestedAsset => Boolean(asset));
      if (
        complete.length !== template.length ||
        complete.some(
          (asset) =>
            byId.has(statusKey(asset)) ||
            organization.assets[statusKey(asset)] ||
            Object.keys(suggestionValidationErrors(session, asset)).length > 0,
        )
      ) {
        skippedNodeIds.push(entry.id);
        continue;
      }
      compatible++;
      complete.forEach((asset) => destinations.set(statusKey(asset), asset));
    }
  }
  const createdAssetIds = [...destinations.keys()].filter((id) => !byId.has(id));
  for (const id of createdAssetIds) organization.generatedAssetIds.add(id);
  for (const [id, destination] of destinations) {
    organization.assets[id] = destination;
    delete mappings[id];
    for (const fieldId of mappedFieldIds(destination)) {
      // Claims are limited to the selected source inputs. Existing destination bindings stay intact.
      if (
        (explicit ? movedDestinationIds.has(id) : id === request.targetAssetId) &&
        !used.has(fieldId)
      )
        continue;
      organization.owners[fieldId] = id;
      organization.releasedFieldIds.delete(fieldId);
      if (destination.variant === 'rescued-fields') preservation.rescued.add(fieldId);
      else preservation.rescued.delete(fieldId);
      if (entryNote(destination.fromNodeId)?.id === fieldId) {
        preservation.entryNotes[destination.fromNodeId] = 'protected';
      }
    }
  }
  const originals = sourceSuggestions(session);
  const projected = projectSuggestions(
    session,
    originals,
    mappings,
    context.plainTextOverrides,
    context.plainTextAssetIds,
    context.typeOverrides,
    preservation,
    organization,
    workspace,
  );
  const assets = projectAssets(
    session,
    projected,
    workspace,
    decisions,
    context.plainTextAssetIds,
    context.typeOverrides,
    mappings,
    preservation,
    organization,
    originals,
  );
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  preview.assets = preview.groups.flatMap((group) => {
    const asset = assetsById.get(group.id);
    const candidates = entries.get(group.nodeId)?.selected;
    if (!asset) return [];
    const { plainTextValue: _value, ...metadata } = asset;
    return [
      {
        ...metadata,
        schemaFields: asset.schemaFields?.map((field) => ({
          ...field,
          candidates: field.candidates?.filter((candidate) => candidates?.has(candidate.id)),
        })),
      },
    ];
  });
  preview.affectedEntryCount = new Set(
    [...destinations.values()].map((asset) => asset.fromNodeId),
  ).size;
  preview.compatibleEntryCount = compatible;
  preview.skippedEntryCount = skippedNodeIds.length;
  preview.movedFieldCount = Object.keys(organization.owners).filter(
    (id) => organization.owners[id] !== context.organization.owners[id],
  ).length;
  preview.remainingFieldCount =
    [...entries.values()].reduce((count, { selected }) => count + selected.size, 0) - used.size;

  if (!duplicate) {
    for (const group of preview.groups) {
      const asset = assetsById.get(group.id);
      if (asset && hasIncludedSchemaField(asset)) continue;
      const message = 'Complete each destination’s field mapping before confirming.';
      const name = entries.get(group.nodeId)?.node.name;
      return fail(explicit && name ? `${name}: ${message}` : message, group.id);
    }
  }
  const nextDecisions = { ...decisions };
  const revised = new Map(projected.map((asset) => [statusKey(asset), asset]));
  const changed = new Set(destinations.keys());
  for (const original of projection.suggestions) {
    const id = statusKey(original);
    const next = revised.get(id);
    if (!next || JSON.stringify(original.fieldBindings) !== JSON.stringify(next.fieldBindings))
      changed.add(id);
  }
  for (const id of changed) {
    if (nextDecisions[id] === 'excluded') continue;
    if (revised.has(id)) nextDecisions[id] = 'needs-review';
    else delete nextDecisions[id];
  }
  let plansByClientId = workspace.plansByClientId;
  for (const plan of listPlanDrafts(workspace)) {
    const removedIds = new Set<string>();
    for (const draft of plan.assets) {
      const original =
        (explicit ? byId.get(draft.id) : undefined) ??
        projection.suggestions.find((asset) => assetMatchesSuggestion(session, draft, asset));
      if (original && changed.has(statusKey(original))) removedIds.add(draft.id);
    }
    if (removedIds.size) {
      if (plansByClientId === workspace.plansByClientId) plansByClientId = { ...plansByClientId };
      plansByClientId[plan.clientId] = {
        ...plan,
        assets: plan.assets.filter(({ id }) => !removedIds.has(id)),
      };
    }
  }
  preview.canConfirm = true;
  return {
    preview,
    change: {
      organization,
      preservation,
      mappings,
      decisions: nextDecisions,
      workspace: { ...workspace, plansByClientId, revision: workspace.revision + 1 },
      result: {
        success: true,
        message: 'Fields organized. Review the changed assets before placing them in a plan.',
        createdAssetIds,
        changedAssetIds: [...changed],
        skippedNodeIds: request.repeatCompatible ? skippedNodeIds : undefined,
      },
    },
  };
}

export function isolateDuplicatedText(change: FieldOperationChange) {
  for (const id of change.result.createdAssetIds) {
    const asset = change.organization.assets[id];
    const binding = asset.fieldBindings[textKey];
    if (binding?.kind === 'literal') {
      change.organization.assets[id] = {
        ...asset,
        fieldBindings: {
          [textKey]: { kind: 'literal', value: new SensitiveValue(binding.value.reveal()) },
        },
      };
    }
  }
}
