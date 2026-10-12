export type ImportFileStatus = 'imported' | 'warning' | 'unlock-required' | 'retrying' | 'failed';

export interface ImportFile {
  id?: string;
  name: string;
  format: string;
  entries?: number;
  warnings?: number;
  status: ImportFileStatus;
  detail?: string;
  warningMessages?: string[];
}
export interface SourceImportStatusProps {
  files: ImportFile[];
  description?: string;
  onRetry?: (file: ImportFile) => void;
  onAddFiles?: () => void;
  onUnlock?: (file: ImportFile, password: string, keyFile?: ArrayBuffer) => void;
  onViewWarnings?: (file: ImportFile) => void;
  onRemove?: (file: ImportFile) => void;
}
