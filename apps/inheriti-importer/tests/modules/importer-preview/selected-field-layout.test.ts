import { describe, expect, it } from 'vitest';
import type { FieldOperationGroup } from '@modules/importer-preview/AssetReviewQueue/field-operations';
import { applySelectedFieldLayout } from '@modules/importer-preview/AssetReviewQueue/selected-field-layout';

function fixtureEntry(nodeId: string, names: string[], sourceId = 'import') {
  const fields = names.map((name, index) => ({ id: `${nodeId}-${index}`, nodeId, sourceId, name }));
  const entry = {
    nodeId,
    sourceId,
    name: nodeId,
    sourceAssetId: `${nodeId}-asset`,
    fieldIds: fields.map(({ id }) => id),
  };
  return { entry, fields };
}

const template = fixtureEntry('template', ['User', 'Password', 'Recovery']);
const matching = fixtureEntry('matching', ['Recovery', 'Other', 'Password', 'User']);
const edited = fixtureEntry('edited', ['User', 'Password', 'Recovery']);
const missing = fixtureEntry('missing', ['User', 'Password']);
const ambiguous = fixtureEntry('ambiguous', ['User', 'Password', 'Recovery', 'User']);
const otherSource = fixtureEntry(
  'other-source',
  ['User', 'Password', 'Recovery'],
  'unrelated-import',
);
const outside = fixtureEntry('outside', ['User', 'Password', 'Recovery']);
const excludedFromInput = fixtureEntry('unselected', ['User', 'Password', 'Recovery']);

const templateGroups: FieldOperationGroup[] = [
  {
    id: 'template-login',
    nodeId: 'template',
    name: 'Manual source name',
    type: 'LOGIN',
    fieldBindings: { 'secret.username': 'template-0', 'secret.password': 'template-1' },
  },
  {
    id: 'template-text',
    nodeId: 'template',
    name: 'Manual source text name',
    type: 'PLAIN-TEXT',
    fieldBindings: { 'secret.text': ['template-2'] },
  },
];
const editedGroup = {
  id: 'manual-edited',
  nodeId: 'edited',
  name: 'Keep this name',
  type: 'PLAIN-TEXT',
  fieldBindings: { 'secret.text': ['edited-0'] },
};
const outsideGroup = {
  id: 'matching:ASSET-operation-layout-0',
  nodeId: 'outside',
  name: 'Keep outside group',
  type: 'PLAIN-TEXT',
  fieldBindings: { 'secret.text': ['outside-0'] },
};
const matchingGroup = { ...editedGroup, id: 'old-matching-group', nodeId: 'matching' };
const selected = [template, matching, edited, missing, ambiguous, otherSource, excludedFromInput];

function input() {
  const groups = [...templateGroups, editedGroup, outsideGroup, matchingGroup];
  return {
    templateNodeId: template.entry.nodeId,
    operationId: 'operation',
    entries: selected.map(({ entry }) => ({
      ...entry,
      fieldIds: entry.nodeId === 'unselected' ? entry.fieldIds.slice(0, 2) : [...entry.fieldIds],
    })),
    fields: [...selected, outside].flatMap(({ fields }) => fields),
    groups,
    validGroupIds: groups.map(({ id }) => id),
    editedNodeIds: new Set(['edited']),
  };
}

describe('selected field layout', () => {
  it('copies bindings by name, leaves additional selected fields available and preserves other groups', () => {
    const options = input();
    const snapshot = structuredClone(options);
    const result = applySelectedFieldLayout(options);

    expect(result.matchedNodeIds).toEqual(['matching']);
    expect(result.skipped).toEqual([
      { nodeId: 'edited', reason: 'edited' },
      { nodeId: 'missing', reason: 'missing-field' },
      { nodeId: 'ambiguous', reason: 'ambiguous-field' },
      { nodeId: 'other-source', reason: 'different-source' },
      { nodeId: 'unselected', reason: 'missing-field' },
    ]);
    expect(result.groups).toEqual([
      ...templateGroups,
      editedGroup,
      outsideGroup,
      {
        id: 'matching:ASSET-operation-layout-1',
        nodeId: 'matching',
        type: 'LOGIN',
        name: '',
        automaticName: true,
        fieldBindings: { 'secret.username': 'matching-3', 'secret.password': 'matching-2' },
      },
      {
        id: 'matching:ASSET-operation-layout-2',
        nodeId: 'matching',
        type: 'PLAIN-TEXT',
        name: '',
        automaticName: true,
        fieldBindings: { 'secret.text': ['matching-0'] },
      },
    ]);
    expect(options).toEqual(snapshot);
    expect(
      applySelectedFieldLayout({
        ...options,
        groups: result.groups,
        validGroupIds: result.groups.map(({ id }) => id),
      }),
    ).toEqual(result);
  });

  it('limits requested target IDs to entries in the current preview', () => {
    const options = input();
    const result = applySelectedFieldLayout({
      ...options,
      targetNodeIds: ['template', 'outside', 'matching'],
    });
    expect(result.matchedNodeIds).toEqual(['matching']);
    expect(result.skipped).toEqual([]);
    expect(result.groups).toContain(outsideGroup);
  });

  it('preserves target groups when a fully assigned template group failed preview validation', () => {
    const options = input();
    const result = applySelectedFieldLayout({
      ...options,
      validGroupIds: options.validGroupIds.filter((id) => id !== templateGroups[0].id),
      targetNodeIds: ['matching'],
    });

    expect(result.groups).toBe(options.groups);
    expect(result.matchedNodeIds).toEqual([]);
    expect(result.skipped).toEqual([{ nodeId: 'matching', reason: 'invalid-template' }]);
  });

  it.each([
    ['an incomplete distribution', { 'secret.text': [] }],
    ['a reused source field', { 'secret.text': ['template-0'] }],
    ['a field outside the template selection', { 'secret.text': ['outside-2'] }],
  ])('preserves groups when the template has %s', (_label, fieldBindings) => {
    const options = input();
    options.groups = [{ ...templateGroups[1], fieldBindings }, templateGroups[0], matchingGroup];
    const result = applySelectedFieldLayout({ ...options, targetNodeIds: ['matching'] });
    expect(result.groups).toBe(options.groups);
    expect(result.matchedNodeIds).toEqual([]);
    expect(result.skipped).toEqual([{ nodeId: 'matching', reason: 'invalid-template' }]);
  });
});
