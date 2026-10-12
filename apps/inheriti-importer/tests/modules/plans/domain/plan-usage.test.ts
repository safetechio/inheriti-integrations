import { describe, expect, it } from 'vitest';
import { previewAssetMove } from '@modules/plans/domain/plan-usage';

describe('previewAssetMove', () => {
  it('reports exact destination deltas without applying the move', () => {
    const asset = {
      id: 'asset-1',
      type: 'PLAIN-TEXT',
      meta: { name: 'Secret' },
      secret: { text: 'hello' },
    };
    const result = previewAssetMove({
      asset,
      fromAssets: [asset],
      toAssets: [],
      limits: { maxChars: 100, maxFiles: 1, maxFileBytes: 1000 },
    });

    expect(result.from.after.chars).toBe(0);
    expect(result.to.after.chars).toBe(5);
    expect(result.to.after.files).toBe(0);
    expect(result.to.after.withinLimits).toBe(true);
  });
});
