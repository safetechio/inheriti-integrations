import type { ReviewAsset, ReviewAssetField } from './types';

export interface FieldOperationGroup {
  id: string;
  nodeId: string;
  type: string;
  name: string;
  automaticName?: boolean;
  rationale?: string;
  fieldBindings: Record<string, string | string[]>;
}

export interface FieldOperationEntry {
  sourceAssetId: string;
  fieldIds: string[];
  targetAssetId?: string;
}

export interface FieldOperationRequest extends FieldOperationEntry {
  entries?: FieldOperationEntry[];
  action: 'detect' | 'create' | 'suggest' | 'move' | 'plain-text' | 'duplicate-text';
  type?: string;
  repeatCompatible?: boolean;
  groups?: FieldOperationGroup[];
  operationId?: string;
}

export interface FieldOperationPreview {
  request: FieldOperationRequest;
  entries?: (FieldOperationEntry & { nodeId: string; sourceId: string; name: string })[];
  token: symbol;
  groups: FieldOperationGroup[];
  assets: ReviewAsset[];
  errors: string[];
  groupErrors?: Record<string, string>;
  canConfirm: boolean;
  affectedEntryCount: number;
  compatibleEntryCount: number;
  skippedEntryCount: number;
  movedFieldCount: number;
  remainingFieldCount: number;
}

export interface FieldOperationResult {
  success: boolean;
  message: string;
  createdAssetIds: string[];
  changedAssetIds: string[];
  removedAssetIds?: string[];
  skippedNodeIds?: string[];
}

export interface FieldOperationControls {
  assetTypes?: string[];
  schemaFields?: (type: string) => ReviewAssetField[];
  preview(request: FieldOperationRequest): FieldOperationPreview;
  commit(preview: FieldOperationPreview): FieldOperationResult;
  remove?(assetIds: string[]): FieldOperationResult;
  undo(): FieldOperationResult;
  canUndo: boolean;
}
