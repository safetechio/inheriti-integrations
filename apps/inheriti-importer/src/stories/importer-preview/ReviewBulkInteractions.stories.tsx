import { useEffect, useRef, useState } from 'react';
import { AssetReviewQueue, type ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';
import { hasIncludedSchemaField } from '@modules/importer-preview/AssetReviewQueue/types';
import { ImporterFlow } from '@modules/importer-preview/ImporterFlow';
import { AppHeader } from '@modules/import/ui/components/AppHeader';
import type { ImporterFlowCallbacks } from '@modules/importer-preview/ImporterFlow/hooks/use-importer-flow';
import { useImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/importer-workspace';
import { createEmptyWorkspace } from '@modules/plans/domain/workspace-model';
import { SensitiveValue } from '@modules/import/domain/import-model';
import { ShellFixture } from './shell-fixtures';
import { createAssetFlowFixture } from './asset-flow-fixture';

type Scenario = 'mixed' | 'reviewed' | 'filtered' | 'large' | 'undo';

function ReviewBulkStory({
  scenario,
  fullFlow = false,
}: {
  scenario: Scenario;
  fullFlow?: boolean;
}) {
  const [{ session, files }] = useState(() => {
    const fixture = createAssetFlowFixture();
    if (scenario === 'mixed' || scenario === 'filtered') {
      const field = fixture.session.fieldsById['env-key:API_KEY'];
      if (field) field.value = new SensitiveValue('');
    }
    if (scenario === 'large') {
      const count = 1500;
      for (let index = 0; index < count; index++) {
        const id = `synthetic-large-${index}`;
        const fields = ['username', 'password'];
        if (index % 3 === 0) fields.push('url');
        if (index === 0) fields.push('email');
        fixture.session.nodesById[id] = {
          id,
          sourceId: 'synthetic-vault',
          parentNodeId: null,
          kind: 'entry',
          name: `Synthetic service ${index}`,
          path: [],
          childNodeIds: [],
          fieldIds: fields.map((field) => `${id}:${field}`),
        };
        fixture.session.rootNodeIds.push(id);
        for (const field of fields) {
          const fieldId = `${id}:${field}`;
          fixture.session.fieldsById[fieldId] = {
            id: fieldId,
            sourceId: 'synthetic-vault',
            parentNodeId: id,
            sourcePath: [`Synthetic service ${index}`, field],
            name: field,
            value: new SensitiveValue(
              field === 'email'
                ? 'invalid-address'
                : field === 'url'
                  ? `https://service-${index}.example.invalid`
                  : field === 'username' && index % 2 === 0
                    ? `service-${index}@example.invalid`
                    : `synthetic-${field}-${index}`,
            ),
            metadata: {},
          };
        }
      }
      if (fixture.files[0]) fixture.files[0].entries = (fixture.files[0].entries ?? 0) + count;
    }
    return fixture;
  });
  const [state, setState] = useState(createEmptyWorkspace);
  const [selectedId, setSelectedId] = useState<string>();
  const workspace = useImporterWorkspace(session, state, setState);
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || scenario === 'large' || scenario === 'undo') return;
    seeded.current = true;
    const eligible = workspace.assets.filter(hasIncludedSchemaField);
    if (scenario === 'reviewed') {
      for (const asset of eligible) workspace.reviewAsset('accept', asset);
      for (const asset of workspace.assets.filter((asset) => !hasIncludedSchemaField(asset)))
        workspace.reviewAsset('exclude', asset);
    } else {
      if (eligible[0]) workspace.reviewAsset('accept', eligible[0]);
      if (eligible[1]) workspace.reviewAsset('exclude', eligible[1]);
    }
  }, [scenario, workspace]);
  const onAction = (action: string, asset: ReviewAsset) => {
    if (
      action === 'accept' ||
      action === 'exclude' ||
      action === 'restore' ||
      action === 'restore-suggestion'
    ) {
      workspace.reviewAsset(action, asset);
    } else if (action.startsWith('alternate:')) {
      workspace.reviewAsset(`alternate:${action.slice('alternate:'.length)}`, asset);
    }
  };
  const callbacks = {
    onReviewAssets: workspace.reviewAssets,
    onUndoReviewBatch: workspace.undoReviewBatch,
    canUndoReviewBatch: workspace.canUndoReviewBatch,
    onApplyMappings: workspace.applyMappings,
    onAcceptAllEligible: workspace.acceptAllEligible,
    onUndoAcceptAll: workspace.undoAcceptAll,
    resolveSourceValue: workspace.resolveSourceValue,
    onMapField: workspace.mapAssetField,
    onEditPlainText: workspace.editPlainText,
  } satisfies ImporterFlowCallbacks;
  if (fullFlow) {
    return (
      <ShellFixture>
        <ImporterFlow
          headerActions={<AppHeader dirtyCount={0} />}
          initialStage="assets"
          files={files}
          assets={workspace.assets}
          unassigned={workspace.unassigned}
          plans={workspace.plans}
          checklist={[]}
          callbacks={{ ...callbacks, onReviewAsset: onAction }}
        />
      </ShellFixture>
    );
  }
  return (
    <ShellFixture>
      <AssetReviewQueue
        assets={workspace.assets}
        selectedId={selectedId}
        onSelect={(asset) => setSelectedId(asset.id)}
        sourceFiles={files}
        onAction={onAction}
        {...callbacks}
      />
    </ShellFixture>
  );
}

export const MixedEligibility = () => <ReviewBulkStory scenario="mixed" />;
export const AllReviewedNoEligible = () => <ReviewBulkStory scenario="reviewed" />;
export const SourceFilterDoesNotLimitBulk = () => <ReviewBulkStory scenario="filtered" />;
export const LargeSyntheticSet = () => <ReviewBulkStory scenario="large" />;
export const UndoPreservesLaterManualDecision = () => <ReviewBulkStory scenario="undo" />;

export const FullFlowReviewAssets = () => <ReviewBulkStory scenario="mixed" fullFlow />;
FullFlowReviewAssets.meta = { iframed: true };

export const FullFlowLargeReview = () => <ReviewBulkStory scenario="large" fullFlow />;
FullFlowLargeReview.meta = { iframed: true };
