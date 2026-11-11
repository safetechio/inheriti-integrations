import { useState } from 'react';
import { AssetReviewQueue, type ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';
import { reviewAssets } from './fixtures';

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
        if (action !== 'accept' && action !== 'exclude') return;
        setItems((current) =>
          current.map((item) =>
            item.id === asset.id
              ? { ...item, status: action === 'accept' ? 'accepted' : 'excluded' }
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
