import type { ImportFileStatus } from '../types';

export const labels: Record<ImportFileStatus, string> = {
  imported: 'Imported',
  warning: 'Imported with warnings',
  'unlock-required': 'Unlock required',
  retrying: 'Retrying',
  failed: 'Failed',
};
export const statusBadge: Record<
  ImportFileStatus,
  { tone: 'success' | 'warning' | 'info' | 'danger'; icon: string }
> = {
  imported: { tone: 'success', icon: 'circle-check' },
  warning: { tone: 'warning', icon: 'circle-exclamation' },
  'unlock-required': { tone: 'info', icon: 'key' },
  retrying: { tone: 'info', icon: 'rotate' },
  failed: { tone: 'danger', icon: 'triangle-exclamation' },
};
