import { ImporterFlow, type ImporterFlowProps } from '@modules/importer-preview/ImporterFlow';

const fileName = 'demo-import.kdbx';
const sourceId = 'demo-source';
const groupingAssets = [
  { id: 'account', name: 'Demo sign-in', type: 'USER-PSWD' },
  { id: 'notes', name: 'Demo setup notes', type: 'PLAIN-TEXT' },
];

const props: ImporterFlowProps = {
  files: [{ id: sourceId, name: fileName, format: 'KeePass', entries: 2, status: 'imported' }],
  assets: groupingAssets.map((asset) => ({
    ...asset,
    status: 'suggested',
    rationale: 'Suggested asset type from the sample source.',
    mapped: ['name'],
    unmapped: [],
    source: fileName,
    sourceId,
    alternatives: ['PLAIN-TEXT'],
  })),
  unassigned: groupingAssets.map((asset) => ({ ...asset, source: fileName, sourceId })),
  plans: [
    { id: 'draft', name: 'Sample draft', assets: 0, capacity: '0 of 10 assets', valid: true },
  ],
  checklist: [],
  autoAdvance: false,
};

export const ReviewAssets = () => <ImporterFlow {...props} initialStage="assets" />;

export const CreatePlans = () => <ImporterFlow {...props} initialStage="plans" />;

export const FirstVisit = () => (
  <ImporterFlow {...props} initialStage="assets" showQuickGuideOnFirstVisit />
);
