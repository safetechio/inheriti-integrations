import { useState } from 'react';
import { reviewDecisionStatus } from '@modules/importer-preview/AssetReviewQueue/types';
import { AssetReviewQueue, type ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';
import { useImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/importer-workspace';
import { createEmptyWorkspace } from '@modules/plans/domain/workspace-model';
import { reviewAssets } from './fixtures';
import { createAssetFlowFixture } from './asset-flow-fixture';

const assets: ReviewAsset[] = reviewAssets.map((asset, index) => ({
  ...asset,
  sourceId: index === 1 ? 'staging' : 'production',
  sourceFileName: index === 1 ? 'staging.env' : 'prod.kdbx',
  folderPath: index === 0 ? ['Infrastructure', 'Database'] : index === 2 ? ['Recovery'] : [],
}));

export const InteractiveReview = () => {
  const [items, setItems] = useState(assets);
  const [selectedId, setSelectedId] = useState(assets[0].id);
  return (
    <AssetReviewQueue
      assets={items}
      selectedId={selectedId}
      onSelect={(asset) => setSelectedId(asset.id)}
      onAction={(action, asset) => {
        if (action !== 'accept' && action !== 'exclude' && action !== 'restore') return;
        setItems((current) =>
          current.map((item) =>
            item.id === asset.id
              ? { ...item, status: reviewDecisionStatus[action] }
              : item,
          ),
        );
      }}
    />
  );
};

export const AcceptedAndExcluded = () => (
  <AssetReviewQueue
    assets={assets.map((asset, index) => ({
      ...asset,
      status: index === 0 ? 'accepted' : index === 1 ? 'excluded' : asset.status,
    }))}
    selectedId={assets[0].id}
  />
);

export const TypeChangedNeedsMapping = () => (
  <AssetReviewQueue
    assets={[
      {
        ...assets[1],
        type: 'USER-PSWD',
        status: 'needs-review',
        rationale:
          'Asset type changed during review. Map and validate its fields before accepting.',
        schemaFields: [
          {
            key: 'secret.username',
            label: 'Username',
            candidates: assets[1].schemaFields?.[0]?.candidates,
          },
          {
            key: 'secret.password',
            label: 'Password',
            candidates: assets[1].schemaFields?.[0]?.candidates,
          },
        ],
      },
    ]}
    onAction={() => undefined}
  />
);

function FieldDestinationStory({ manySources = false }: { manySources?: boolean }) {
  const [{ session, files }] = useState(() => {
    const fixture = createAssetFlowFixture();
    if (manySources)
      for (let index = 1; index <= 3; index++) {
        const id = `archive-${index}`;
        const name = `Archive ${index} — long source name for overflow.csv`;
        fixture.session.sources.push({
          id,
          name,
          fileName: name,
          kind: 'passbolt',
          importedAt: '',
          warnings: [],
        });
        fixture.files.push({ id, name, format: 'CSV', entries: 0, status: 'imported' });
      }
    return fixture;
  });
  const [state, setState] = useState(createEmptyWorkspace);
  const workspace = useImporterWorkspace(session, state, setState);
  return (
    <AssetReviewQueue
      assets={workspace.assets}
      sourceFiles={files}
      resolveSourceValue={workspace.resolveSourceValue}
      onMapField={workspace.mapAssetField}
      preservation={{
        coverage: workspace.coverage,
        fieldOperations: workspace.fieldOperations,
        noteSources: workspace.noteSources,
        onPreserveFields: workspace.preserveFields,
        onExcludeFields: workspace.excludeFields,
        onRenameAsset: workspace.renameAsset,
      }}
    />
  );
}

export const SourceFieldDestinations = () => <FieldDestinationStory />;
export const ManySourceFieldDestinations = () => <FieldDestinationStory manySources />;


export const ResolvedFieldsWithWarnings = () => (
  <AssetReviewQueue
    assets={[{
      ...assets[0], id: 'resolved', name: 'Resolved account', sourceId: 'source',
      sourceNodeId: 'entry', status: 'suggested', schemaFields: [], unmapped: [], note: undefined,
    }]}
    preservation={{
      noteSources: [],
      coverage: {
        ready: true, fields: [], diagnostics: [
          { sourceId: 'source', entryId: 'entry', kind: 'skipped', code: 'metadata', count: 1,
            message: 'Source display metadata was skipped.' },
          { sourceId: 'source', entryId: 'entry', kind: 'transformed', code: 'structure', count: 1,
            message: 'A structured field was preserved as JSON.' },
        ],
      },
    }}
  />
);
