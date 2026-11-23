import { useState } from 'react';
import { SensitiveValue, createEmptyImportSession } from '@modules/import/domain/import-model';
import { useImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/importer-workspace';
import { AssetReviewQueue } from '@modules/importer-preview/AssetReviewQueue';
import { createEmptyWorkspace } from '@modules/plans/domain/workspace-model';
import type { ImportFile } from '@modules/importer-preview/SourceImportStatus';
import { ShellFixture } from './shell-fixtures';

function createBulkFixture() {
  const session = createEmptyImportSession('bulk-field-creation');
  const sources = [
    { id: 'bulk-a', name: 'bulk-primary-a.json', kind: 'synthetic', format: 'JSON' },
    { id: 'bulk-b', name: 'bulk-primary-b.json', kind: 'synthetic', format: 'JSON' },
  ];
  session.sources = sources.map((source) => ({
    ...source,
    fileName: source.name,
    importedAt: '2026-01-01',
    warnings: [],
  }));
  const files: ImportFile[] = sources.map((source) => ({
    id: source.id,
    name: source.name,
    format: source.format,
    entries: 22,
    status: 'imported',
  }));
  for (const source of sources) {
    for (let index = 1; index <= 22; index++) {
      const id = `${source.id}:entry-${index}`;
      const fields = [
        ['username', `user-${source.id}-${index}`],
        ['password', `password-${source.id}-${index}`],
        ['region', `region-${index % 3}`],
        ['enabled', index % 2 ? 'true' : 'false'],
        ['retries', String(index % 5)],
      ] as const;
      session.nodesById[id] = {
        id,
        sourceId: source.id,
        parentNodeId: null,
        kind: 'entry',
        name: `Primary ${source.id} ${index}`,
        path: [],
        childNodeIds: [],
        fieldIds: fields.map(([name]) => `${id}:${name}`),
      };
      session.rootNodeIds.push(id);
      for (const [name, value] of fields) {
        const fieldId = `${id}:${name}`;
        session.fieldsById[fieldId] = {
          id: fieldId,
          sourceId: source.id,
          parentNodeId: id,
          sourcePath: [session.nodesById[id].name, name],
          name,
          value: new SensitiveValue(value),
          metadata: {},
        };
      }
    }
  }
  return { session, files };
}

export const LargeTwoSourceBulkCreation = () => {
  const [{ session, files }] = useState(createBulkFixture);
  const [state, setState] = useState(createEmptyWorkspace);
  const workspace = useImporterWorkspace(session, state, setState);
  return (
    <ShellFixture>
      <AssetReviewQueue
        assets={workspace.assets}
        sourceFiles={files}
        resolveSourceValue={workspace.resolveSourceValue}
        onMapField={workspace.mapAssetField}
        onReviewAssets={workspace.reviewAssets}
        onApplyMappings={workspace.applyMappings}
        onAction={(action, asset) => {
          if (
            action === 'accept' ||
            action === 'exclude' ||
            action === 'restore' ||
            action === 'restore-suggestion'
          )
            workspace.reviewAsset(action, asset);
        }}
        preservation={{
          coverage: workspace.coverage,
          fieldOperations: workspace.fieldOperations,
          noteSources: workspace.noteSources,
          onPreserveFields: workspace.preserveFields,
          onExcludeFields: workspace.excludeFields,
          onRenameAsset: workspace.renameAsset,
        }}
      />
    </ShellFixture>
  );
};
