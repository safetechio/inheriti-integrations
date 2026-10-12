export type SourceFieldStatus = 'MAPPED' | 'PARTIALLY_MAPPED' | 'UNMAPPED' | 'IGNORED' | 'INVALID';

export interface SourceFieldBindingRef {
  planClientId: string;
  assetId: string;
  assetFieldSource: string;
}
