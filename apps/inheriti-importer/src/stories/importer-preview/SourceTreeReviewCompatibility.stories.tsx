import { useState } from 'react';
import { AssetReviewQueue, type ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';
import { useImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/importer-workspace';
import { createEmptyWorkspace } from '@modules/plans/domain/workspace-model';
import { ShellFixture } from './shell-fixtures';
import { createAssetFlowFixture } from './asset-flow-fixture';

export const SourceTreeWithBulkAcceptance = () => {
  const [{ session, files }] = useState(createAssetFlowFixture);
  const [state, setState] = useState(createEmptyWorkspace);
  const [selectedId, setSelectedId] = useState<string>();
  const workspace = useImporterWorkspace(session, state, setState);
  const onAction = (action: string, asset: ReviewAsset) => {
    if (action === 'accept' || action === 'exclude' || action === 'restore-suggestion')
      workspace.reviewAsset(action, asset);
  };
  return (
    <ShellFixture>
      <AssetReviewQueue
        assets={workspace.assets}
        sourceFiles={files}
        selectedId={selectedId}
        onSelect={(asset) => setSelectedId(asset.id)}
        onAction={onAction}
        onAcceptAllEligible={workspace.acceptAllEligible}
        onUndoAcceptAll={workspace.undoAcceptAll}
        resolveSourceValue={workspace.resolveSourceValue}
        onMapField={workspace.mapAssetField}
        onEditPlainText={workspace.editPlainText}
      />
    </ShellFixture>
  );
};
