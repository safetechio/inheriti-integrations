import { describe, expect, it, vi } from 'vitest';
vi.mock('@safetech/inheriti-elements-core/node', () => ({ quickPlanAssetCatalog: [
  { id: 'PLAIN-TEXT', category: 'GENERAL-DATA', fields: ['text'] },
  { id: 'DOCUMENT', category: 'MEDIA-FILES', fields: ['data', 'mimeType'] },
] }));
import { parseQuickPlanInput } from '../src/modules/quick-plan/main/quick-plan-input.js';

describe('quick plan IPC input', () => {
  it('keeps media metadata and rejects unknown secret fields', () => {
    const input = parseQuickPlanInput({
      title: 'My file',
      asset: {
        type: 'DOCUMENT',
        meta: { name: 'Document', isMedia: true, mimeType: 'application/pdf', fileName: 'sample.pdf' },
        secret: { data: 'YWJj', mimeType: 'application/pdf', fileName: 'sample.pdf' },
      },
    });
    expect(input.asset.secret).toEqual({ data: 'YWJj', mimeType: 'application/pdf', fileName: 'sample.pdf' });
    expect(input.asset.meta).toMatchObject({ isMedia: true, fileName: 'sample.pdf' });
    expect(() => parseQuickPlanInput({ title: 'Invalid', asset: { type: 'PLAIN-TEXT', meta: { name: 'Note' }, secret: { text: 'x', bearerToken: 'x' } } })).toThrow();
  });
});
