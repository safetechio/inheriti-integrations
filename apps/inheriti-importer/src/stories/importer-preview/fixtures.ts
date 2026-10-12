import type { ChecklistItem } from '@modules/importer-preview/FinalStagingChecklist';
import type { ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';
import type { ImportFile } from '@modules/importer-preview/SourceImportStatus';
import type { GroupingAsset, PlanDraft } from '@modules/importer-preview/PlanGroupingSurface';
export const sourceFiles: ImportFile[] = [
  { name: 'prod.kdbx', format: 'KeePass', entries: 42, warnings: 2, status: 'warning' },
  { name: 'staging.env', format: 'dotenv', entries: 18, warnings: 0, status: 'imported' },
  { name: 'vault.json', format: 'Vault', status: 'unlock-required' },
  { name: 'legacy.csv', format: 'CSV', status: 'failed' },
];
export const reviewAssets: ReviewAsset[] = [
  {
    id: 'asset-1',
    name: 'Production database',
    type: 'USER-PSWD',
    status: 'suggested',
    confidence: 'High confidence',
    rationale: 'Matched username and password fields.',
    mapped: ['username', 'password'],
    unmapped: ['rotation_owner'],
    source: 'prod.kdbx · Infrastructure / Database',
    alternatives: ['PLAIN-TEXT', 'API-KEY'],
    previewFields: ['Username', 'Password'],
    schemaFields: [
      {
        key: 'secret.appOrWebsite',
        label: 'App or website',
        sourceFieldId: 'asset-1:url',
        sourceFieldName: 'url',
        candidates: [
          { id: 'asset-1:url', name: 'url' },
          { id: 'asset-1:username', name: 'username' },
          { id: 'asset-1:password', name: 'password' },
        ],
      },
      {
        key: 'secret.username',
        label: 'Username',
        sourceFieldId: 'asset-1:username',
        sourceFieldName: 'username',
        candidates: [
          { id: 'asset-1:url', name: 'url' },
          { id: 'asset-1:username', name: 'username' },
          { id: 'asset-1:password', name: 'password' },
        ],
      },
      {
        key: 'secret.password',
        label: 'Password',
        sourceFieldId: 'asset-1:password',
        sourceFieldName: 'password',
        candidates: [
          { id: 'asset-1:url', name: 'url' },
          { id: 'asset-1:username', name: 'username' },
          { id: 'asset-1:password', name: 'password' },
        ],
      },
    ],
  },
  {
    id: 'asset-2',
    name: 'Partner integration',
    type: 'API-KEY',
    status: 'needs-review',
    confidence: 'Needs review',
    rationale: 'A token-like field was found, but no provider label was detected.',
    mapped: ['apiKey'],
    unmapped: ['endpoint'],
    source: 'staging.env · PARTNER_API',
    alternatives: ['PLAIN-TEXT'],
    previewFields: ['API key'],
    schemaFields: [
      {
        key: 'secret.apiKey',
        label: 'API key',
        sourceFieldId: 'asset-2:token',
        sourceFieldName: 'PARTNER_API',
        candidates: [
          { id: 'asset-2:token', name: 'PARTNER_API' },
          { id: 'asset-2:endpoint', name: 'PARTNER_ENDPOINT' },
        ],
      },
    ],
  },
  {
    id: 'asset-3',
    name: 'Recovery note',
    type: 'PLAIN-TEXT',
    status: 'fallback',
    confidence: 'Fallback',
    rationale: 'No safe structured mapping was available.',
    mapped: [],
    unmapped: ['note'],
    source: 'prod.kdbx · Recovery',
    alternatives: ['RECOVERY-CODE'],
    previewFields: ['Value'],
    schemaFields: [
      {
        key: 'secret.text',
        label: 'Text',
        sourceFieldId: 'asset-3:note',
        sourceFieldName: 'note',
        candidates: [{ id: 'asset-3:note', name: 'note' }],
      },
    ],
  },
];
export const unassigned: GroupingAsset[] = [
  { id: 'asset-1', name: 'Production database', type: 'USER-PSWD', valid: true },
  { id: 'asset-2', name: 'Partner integration', type: 'API-KEY', valid: false },
];
export const plans: PlanDraft[] = [
  {
    id: 'plan-1',
    name: 'Production infrastructure',
    description: 'Core infrastructure credentials and operational access.',
    assets: 3,
    capacity: '3 / 10 Assets',
    valid: true,
    governanceHint: 'Governance is provisional until promotion.',
    assignedAssets: [],
  },
  {
    id: 'plan-2',
    name: 'Partner access',
    description: 'Credentials shared with approved partner integrations.',
    assets: 8,
    capacity: '8 / 10 Assets',
    valid: false,
    governanceHint: 'Access policy is provisional.',
    assignedAssets: [],
  },
];
export const assignedPlans: PlanDraft[] = [
  {
    id: 'plan-1',
    name: 'Production infrastructure',
    assets: 4,
    capacity: '4 / 10 Assets',
    valid: true,
    governanceHint: 'Recipients can be configured in Inheriti® Business.',
    assignedAssets: [{ id: 'asset-3', name: 'Recovery note', type: 'PLAIN-TEXT', valid: true }],
  },
  plans[1],
];
export const emptyPlans: PlanDraft[] = [];
export const overCapacityPlans: PlanDraft[] = [
  {
    id: 'plan-over',
    name: 'Over-capacity draft',
    assets: 11,
    capacity: '11 / 10 Assets',
    valid: false,
    governanceHint: 'Reduce the draft before staging.',
    assignedAssets: [],
  },
];
export const validPlans: PlanDraft[] = [
  {
    id: 'plan-ready',
    name: 'Ready for staging',
    assets: 2,
    capacity: '2 / 10 Assets',
    valid: true,
    governanceHint: 'Recipients can be configured in Inheriti® Business.',
    assignedAssets: [],
  },
];
export const fullPlans: PlanDraft[] = [
  {
    id: 'plan-full',
    name: 'Full draft',
    assets: 10,
    capacity: '10 / 10 Assets',
    valid: true,
    governanceHint: 'Governance is provisional until promotion.',
    assignedAssets: [],
  },
];
export const zeroUsagePlans: PlanDraft[] = [
  {
    id: 'plan-empty',
    name: 'Empty draft',
    assets: 0,
    capacity: '0 / 10 Assets',
    valid: true,
    governanceHint: 'Governance is provisional until promotion.',
    assignedAssets: [],
  },
];
export const checklist: ChecklistItem[] = [
  {
    label: 'Imported sources reviewed',
    detail: 'Warnings and unlock requirements are acknowledged.',
    complete: true,
  },
  {
    label: 'Suggestions reviewed',
    detail: 'Accepted and intentionally excluded Assets are accounted for.',
    complete: true,
  },
  { label: 'Plan assignment', detail: '2 Assets still need a Plan assignment.', complete: false },
  {
    label: 'Organization Key',
    detail: 'Configured; release and verification occur during staging.',
    complete: false,
  },
  {
    label: 'Encryption',
    detail: 'Every field is encrypted locally before transmission.',
    complete: false,
  },
];
