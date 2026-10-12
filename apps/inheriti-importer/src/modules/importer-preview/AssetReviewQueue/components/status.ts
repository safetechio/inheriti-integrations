import type { AssetReviewStatus } from '../types';

export const statusLabel: Record<AssetReviewStatus, string> = {
  suggested: 'Suggested',
  'needs-review': 'Needs review',
  accepted: 'Accepted',
  excluded: 'Excluded',
  fallback: 'Fallback',
};

export const statusBadge: Record<
  AssetReviewStatus,
  { tone: 'primary' | 'warning' | 'success' | 'neutral' | 'info'; icon: string }
> = {
  suggested: { tone: 'primary', icon: 'circle-info' },
  'needs-review': { tone: 'warning', icon: 'circle-exclamation' },
  accepted: { tone: 'success', icon: 'circle-check' },
  excluded: { tone: 'neutral', icon: 'ban' },
  fallback: { tone: 'info', icon: 'circle-info' },
};

export const statusColor: Record<
  AssetReviewStatus,
  'primary' | 'warning' | 'success' | 'gray' | 'info'
> = {
  suggested: 'primary',
  'needs-review': 'warning',
  accepted: 'success',
  excluded: 'gray',
  fallback: 'info',
};
