import { SensitiveValue } from '@modules/import/domain/import-model';
import { createAssetFlowFixture } from '../asset-flow-fixture';

export function createFolderGroupingFixture(large = false) {
  const fixture = createAssetFlowFixture();
  const session = fixture.session;
  session.sources.push({
    id: 'synthetic-second-vault',
    kind: 'onepassword',
    name: 'second.1pux',
    fileName: 'second.1pux',
    importedAt: '2026-01-01',
    warnings: [],
  });
  fixture.files.push({
    id: 'synthetic-second-vault',
    name: 'second.1pux',
    format: '1Password',
    entries: 4,
    status: 'imported',
  });
  const count = large ? 200 : 13;
  for (let index = 0; index < count; index++) {
    const sourceId = index < 11 ? 'synthetic-vault' : 'synthetic-second-vault';
    const path = index < 11 ? ['Infrastructure', 'Database'] : ['Infrastructure', 'Database'];
    const id = `folder-story-${index}`;
    const name =
      index === 0
        ? `Synthetic credential with a very long descriptive name ${'for visual overflow '.repeat(3)}`
        : `Synthetic credential ${index}`;
    session.nodesById[id] = {
      id,
      sourceId,
      parentNodeId: null,
      kind: 'entry',
      name,
      path,
      childNodeIds: [],
      fieldIds: [`${id}:username`, `${id}:password`],
    };
    session.rootNodeIds.push(id);
    for (const field of ['username', 'password']) {
      const fieldId = `${id}:${field}`;
      session.fieldsById[fieldId] = {
        id: fieldId,
        sourceId,
        parentNodeId: id,
        sourcePath: [...path, name, field],
        name: field,
        value: new SensitiveValue(`synthetic-${field}-${index}`),
        metadata: {},
      };
    }
  }
  if (fixture.files[0])
    fixture.files[0].entries = (fixture.files[0].entries ?? 0) + Math.min(count, 11);
  if (fixture.files[3]) fixture.files[3].entries = count - 11;
  return fixture;
}
