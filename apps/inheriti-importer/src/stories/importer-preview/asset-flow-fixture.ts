import { createEmptyImportSession, SensitiveValue } from '@modules/import/domain/import-model';
import type { ImportFile } from '@modules/importer-preview/SourceImportStatus';

export function createAssetFlowFixture() {
  const session = createEmptyImportSession('synthetic-asset-review');
  const sources = [
    {
      id: 'synthetic-vault',
      name: 'synthetic-vault.1pux',
      kind: 'onepassword',
      format: '1Password',
    },
    { id: 'synthetic-env', name: 'synthetic-flat.env', kind: 'dotenv', format: 'dotenv' },
    { id: 'synthetic-empty', name: 'synthetic-empty.csv', kind: 'passbolt', format: 'CSV' },
  ];
  session.sources = sources.map((source) => ({
    id: source.id,
    kind: source.kind,
    name: source.name,
    fileName: source.name,
    importedAt: '2026-01-01',
    warnings: [],
  }));
  const files: ImportFile[] = sources.map((source) => ({
    id: source.id,
    name: source.name,
    format: source.format,
    entries: source.id === 'synthetic-vault' ? 12 : source.id === 'synthetic-env' ? 2 : 0,
    status: 'imported',
  }));
  const addEntry = (
    id: string,
    sourceId: string,
    name: string,
    path: string[],
    values: Array<[string, string]>,
  ) => {
    const parentNodeId = path.length ? `${sourceId}:${path.join('/')}` : null;
    session.nodesById[id] = {
      id,
      sourceId,
      parentNodeId,
      kind: 'entry',
      name,
      path,
      childNodeIds: [],
      fieldIds: values.map(([field]) => `${id}:${field}`),
    };
    if (parentNodeId) session.nodesById[parentNodeId]!.childNodeIds.push(id);
    else session.rootNodeIds.push(id);
    for (const [field, value] of values) {
      const fieldId = `${id}:${field}`;
      session.fieldsById[fieldId] = {
        id: fieldId,
        sourceId,
        parentNodeId: id,
        sourcePath: [...path, name, field],
        name: field,
        value: new SensitiveValue(value),
        metadata: {},
      };
    }
  };
  for (const path of [['Infrastructure'], ['Infrastructure', 'Database']]) {
    const id = `synthetic-vault:${path.join('/')}`;
    session.nodesById[id] = {
      id,
      sourceId: 'synthetic-vault',
      parentNodeId: path.length > 1 ? `synthetic-vault:${path.slice(0, -1).join('/')}` : null,
      kind: 'group',
      name: path.at(-1)!,
      path: path.slice(0, -1),
      childNodeIds: [],
      fieldIds: [],
    };
    if (path.length === 1) session.rootNodeIds.push(id);
    else session.nodesById[`synthetic-vault:${path.slice(0, -1).join('/')}`]!.childNodeIds.push(id);
  }
  addEntry(
    'vault-database',
    'synthetic-vault',
    'Very long synthetic production database credential for the infrastructure team',
    ['Infrastructure', 'Database'],
    [
      ['username', 'synthetic-database-user'],
      ['password', 'synthetic-password'],
      ['extra:notes', 'Synthetic recovery note'],
      ['extra:region', 'test-region'],
    ],
  );
  addEntry(
    'vault-api',
    'synthetic-vault',
    'Partner API',
    ['Infrastructure'],
    [
      ['token', 'synthetic-token'],
      ['url', 'https://example.invalid/api'],
      ['extra:owner', 'Synthetic team'],
    ],
  );
  for (let index = 1; index <= 10; index++)
    addEntry(
      `vault-service-${index}`,
      'synthetic-vault',
      `Service ${index} credential`,
      ['Infrastructure', 'Database'],
      [
        ['username', `synthetic-user-${index}`],
        ['password', `synthetic-password-${index}`],
      ],
    );
  addEntry(
    'env-key',
    'synthetic-env',
    'Flat API key',
    [],
    [
      ['API_KEY', 'synthetic-flat-key'],
      ['extra:description', 'Synthetic flat source'],
    ],
  );
  addEntry(
    'env-text',
    'synthetic-env',
    'Loose configuration',
    [],
    [
      ['extra:SETTING_A', 'synthetic-A'],
      ['extra:SETTING_B', 'synthetic-B'],
    ],
  );
  return { session, files };
}
